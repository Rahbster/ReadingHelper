import * as peerService from './peer-service.js';
import * as storyManager from '../story-manager.js';
import { ToastManager } from './ToastManager.js';
import { ChatManager } from './ChatManager.js';
import { showPeerConnectionModal } from './modals/peer_connection_modal.js';
import * as aiManager from './ai-manager.js';
import { UIManager } from './UIManager.js';
import { GameManager } from './GameManager.js';
import * as VoiceManager from './VoiceManager.js';
import { SpeechRecognitionManager } from './SpeechRecognitionManager.js';
import * as GameUI from './GameUI.js';

const dom = {
    storyInput: document.getElementById('story-input'),
    storyDisplay: document.getElementById('story-display'),
    chooseStoryBtn: document.getElementById('choose-story-btn'),
    creatorArea: document.getElementById('creator-area'),
    creatorModeBtn: document.getElementById('creator-mode-btn'),
    toggleDashboardBtn: document.getElementById('toggle-dashboard-btn'),
    readerView: document.getElementById('reader-view'),
    dashboardView: document.getElementById('dashboard-view'),
    trickyWordsList: document.getElementById('tricky-words-list'),
    clearStatsBtn: document.getElementById('clear-stats-btn'),
    resetAppBtn: document.getElementById('reset-app-btn'),
    // Modal elements
    syllablePopup: document.getElementById('syllable-popup'),
    storyModal: document.getElementById('story-modal'),
    storyList: document.getElementById('story-list'),    
    storyModalXBtn: document.getElementById('story-modal-x-btn'),
    refreshStoryListBtn: document.getElementById('refresh-story-list-btn'),
    loadFromUrlBtn: document.getElementById('load-from-url-btn'),
    connectBtn: document.getElementById('connect-btn'),
    // Creator mode buttons
    illustrateStoryBtn: document.getElementById('illustrate-story-btn'),
    magicImageBtn: document.getElementById('magic-image-btn'),
    addImageBtn: document.getElementById('add-image-btn'),
    addPhoneticBtn: document.getElementById('add-phonetic-btn'),
    phoneticsEditor: document.getElementById('phonetics-editor'),
    addPronunciationBtn: document.getElementById('add-pronunciation-btn'),
    pronunciationsEditor: document.getElementById('pronunciations-editor'),
    saveStoryBtn: document.getElementById('save-story-btn'),
    // Sidenav
    hamburgerBtn: document.getElementById('hamburger-btn'),
    sidenav: document.getElementById('sidenav'),
    closeSidenavBtn: document.getElementById('close-sidenav-btn'),
    overlay: document.getElementById('overlay'),
    themeToggle: document.getElementById('theme-toggle'),
    settingsNameInput: document.getElementById('settings-name'),
    googleApiKeyInput: document.getElementById('settings-google-api-key'),
    apiKeyStatus: document.getElementById('api-key-status'),
    testApiKeyBtn: document.getElementById('test-api-key-btn'),
    settingsVoiceSelection: document.getElementById('settings-voice-selection'),
    getApiKeyHelpBtn: document.getElementById('get-api-key-help-btn'),
    checkUpdatesBtn: document.getElementById('check-updates-btn'),
    // Chat
    btnOpenChat: document.getElementById('btn-open-chat'),
    chatModal: document.getElementById('chat-modal'),
    closeChatModalBtn: document.getElementById('close-chat-modal'),
    // Game Set Management
    gameSetEditorList: document.getElementById('game-set-editor-list'),
    addGameSetBtn: document.getElementById('add-game-set-btn'),
    gameSetSelectModal: document.getElementById('game-set-select-modal'),
    gameSetSelectList: document.getElementById('game-set-select-list'),
    gameSetSelectXBtn: document.getElementById('game-set-select-x-btn'),
    confirmGameStartBtn: document.getElementById('confirm-game-start-btn'),
    // Celebration
    celebrationModal: document.getElementById('celebration-modal'),
    celebrationCanvas: document.getElementById('celebration-canvas'),
    celebScore: document.getElementById('celeb-score'),
    celebTime: document.getElementById('celeb-time'),
    celebErrors: document.getElementById('celeb-errors'),
    celebPlayAgainBtn: document.getElementById('celeb-play-again-btn'),
    celebDoneBtn: document.getElementById('celeb-done-btn'),
    // Game View
    gameView: document.getElementById('game-view'),
    gameGrid: document.getElementById('game-grid'),
    gameTimer: document.getElementById('game-timer'),
    gameRemainingCount: document.getElementById('game-remaining-count'),
    gameRepeatBtn: document.getElementById('game-repeat-btn'),
    btnGameMode: document.getElementById('btn-game-mode'),
};

let btnReadAloud = null; // Will be created or referenced if exists
let btnReadAlong = null; 

const toastManager = new ToastManager();
const WORD_STATS_KEY = 'readingHelperWordStats';
const SPEED_PREF_KEY = 'readingHelperReadingSpeed';
let currentPronunciations = {}; // Holds the pronunciation guide for the currently loaded story
let currentStoryPath = '';      // Holds the base path for the current story module
let currentPhonetics = {};      // Holds the phonetic guide for the currently loaded story
let localImageUrls = {};        // Holds ObjectURLs for locally loaded images
let pressTimer = null;
let isLongPress = false;
let popupWasShown = false; // Add a new flag to track if the popup was actually displayed
let activeWordElement = null; // Keep track of the element being pressed
let touchStartX = 0;
let touchStartY = 0;
const LONG_PRESS_DURATION = 400; // 400ms for a long press
let isCreatorMode = false;
let currentStoryId = null; // Holds the ID of the currently loaded user story
let sessionImages = {}; // Holds Base64 images for the current session
let isPeerConnected = false;

// Read Aloud State
let sttManager = null;
let readingPointer = 0;
let storyWordElements = [];
let lastProcessedTranscript = ""; // Tracks already-processed text from the current speech segment
let isReadingAlong = false;
let currentReadAlongIndex = 0;
let storyWordMetadata = []; // Cached numeric ranges for high-performance TTS sync
let lastHighlightedReadAlongElement = null;
let readingRate = 1.0;
let isReadAlongPaused = false;
let readAlongSessionId = 0;
let speedUpdateTimeout = null;

/**
 * Shared reference for the live preview listener to allow proper cleanup.
 */
let renderTimeout;
const handleStoryInputPreview = () => {
    // Debounce rendering to improve performance during active typing
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        console.log("[UI] Debounced render triggered");
        renderStory();
    }, 300);
};


// Adapter to allow ChatManager to use peerService
const peerAdapter = {
    send: (data) => peerService.sendData(data)
};

const gameManager = new GameManager({
    toastManager,
    speakFn: (word) => VoiceManager.speakText(word),
    onGameOver: (score, time, errors) => {
        GameUI.stopTimer();
        
        setTimeout(() => {
            GameUI.renderGameGrid();
            VoiceManager.speakText("Amazing job! You finished the game!");
            GameUI.startCelebration(score, time, errors);
        }, 1500);
    }
});

const chatManager = new ChatManager(peerAdapter, () => ({ name: localStorage.getItem('readinghelper_display_name') || 'Anonymous' }));
export const uiManager = new UIManager(dom, chatManager, toastManager);

// Initialize the Game UI module so it has access to the DOM and Managers
GameUI.init({ dom, gameManager, uiManager });

/**
 * Unregisters service workers, clears caches, and all local storage to perform a full reset.
 */
async function resetApplication() {
    if (!confirm('Are you sure you want to perform a full reset? This will clear all cached data, word statistics, and AI metadata.')) {
        return;
    }

    try {
        if ('serviceWorker' in navigator) {
            console.log('Unregistering service workers...');
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }
            console.log('Service workers unregistered.');
        }
        if ('caches' in window) {
            console.log('Clearing caches...');
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
            console.log('Caches cleared.');
        }
        console.log('Clearing local storage...');
        localStorage.clear();
        
        // Force a reload that bypasses the browser cache entirely
        console.log('Reset complete. Reloading page.');
        window.location.href = window.location.origin + window.location.pathname + '?reset=' + Date.now();
    } catch (error) {
        console.error('Error during application reset:', error);
        alert('An error occurred during the reset process. Please check the console for details.');
    }
}

/**
 * Manually triggers a service worker update check.
 */
async function checkForUpdates() {
    uiManager.closeNav();
    if (!navigator.serviceWorker) {
        toastManager.show('Service workers are not supported.', 'error');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        toastManager.show('Checking for updates...', 'info');
        await registration.update();
        
        // The 'controllerchange' listener in setupServiceWorker will handle the reload if an update is found.
    } catch (error) {
        console.error('Manual update check failed:', error);
        toastManager.show('Failed to check for updates.', 'error');
    }
}

/**
 * Registers the service worker and handles updates.
 */
async function setupServiceWorker() {
    if (!navigator.serviceWorker) return;

    try {
        const swUrl = new URL('sw.js', window.location.href).href;
        const registration = await navigator.serviceWorker.register(swUrl);

        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // Notify user of update via Toast
                    toastManager.show('Update available! Refresh to see changes.', 'info', 0);
                }
            });
        });

        // Automatically reload when a new service worker takes control
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    } catch (error) {
        console.error('Service Worker registration failed:', error);
    }
}

/**
 * Main initialization function.
 */
async function init() {
    // Prime the speech synthesis engine early to mitigate the empty voice list race condition
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
    }

    uiManager.initTheme();
    loadWordStats();
    setupServiceWorker();
    
    sttManager = new SpeechRecognitionManager(handleSpeechResult, handleSpeechStatusChange);
    injectReadAloudUI();
    injectReadAlongUI();
    loadPreferences();

    aiManager.init({
        toastManager,
        renderStory,
        openNav: () => uiManager.openNav()
    });
    await loadStoryLibrary();
    setupEventListeners();
    renderDashboard();
    GameUI.renderGameSetEditor();
    VoiceManager.populateVoiceList(dom.settingsVoiceSelection);
    performStorageMaintenance();

    // Handle PWA Shortcuts/URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    if (mode === 'game') {
        GameUI.openGameSetSelector();
    } else if (mode === 'dashboard') {
        uiManager.showView('dashboard');
    }
}

function updateReadingRate(val) {
    readingRate = Math.max(0.8, parseFloat(val));
    localStorage.setItem(SPEED_PREF_KEY, readingRate);
    
    // Sync all speed-related UI elements
    document.querySelectorAll('.speed-slider-input').forEach(el => el.value = readingRate);
    document.querySelectorAll('.speed-display-val').forEach(el => el.textContent = readingRate.toFixed(1));

    // Update immediately if reading along
    if (isReadingAlong) {
        isReadAlongPaused = false; // Resume if speed is changed
        clearTimeout(speedUpdateTimeout);
        speedUpdateTimeout = setTimeout(() => {
            // startReadAlong will increment the sessionId and handle the restart
            startReadAlong();
        }, 100);
    }
}

function loadPreferences() {
    const savedSpeed = localStorage.getItem(SPEED_PREF_KEY);
    if (savedSpeed) {
        readingRate = Math.max(0.8, parseFloat(savedSpeed));
    }
}

/**
 * Injects the Read Aloud toggle button into the header.
 */
function injectReadAloudUI() {
    if (!sttManager.isSupported()) return;

    const headerButtons = document.querySelector('.header-buttons');
    btnReadAloud = document.createElement('button');
    btnReadAloud.id = 'btn-read-aloud';
    btnReadAloud.className = 'theme-button';
    btnReadAloud.innerHTML = `<span>🎤 Karaoke Mode</span>`;
    btnReadAloud.onclick = toggleReadAloud;
    headerButtons.prepend(btnReadAloud);
}

/**
 * Injects the Read Along (Text-to-Speech) button.
 */
function injectReadAlongUI() {
    const headerButtons = document.querySelector('.header-buttons');
    
    const container = document.createElement('div');
    container.className = 'header-speed-control';
    container.innerHTML = `
        <label>Speed: <span class="speed-display-val">${readingRate.toFixed(1)}</span>x</label>
        <input type="range" class="speed-slider-input" min="0.8" max="2.0" step="0.1" value="${readingRate}">
    `;
    
    const slider = container.querySelector('.speed-slider-input');
    slider.oninput = (e) => updateReadingRate(e.target.value);

    btnReadAlong = document.createElement('button');
    btnReadAlong.id = 'btn-read-along';
    btnReadAlong.className = 'theme-button';
    btnReadAlong.innerHTML = `<span>🔊 Story Teller</span>`;
    btnReadAlong.onclick = toggleReadAlong;
    
    headerButtons.prepend(btnReadAlong);
    headerButtons.prepend(container);
}

function toggleReadAlong() {
    if (isReadingAlong) {
        if (isReadAlongPaused) {
            toggleReadAlongPause();
        } else {
            window.speechSynthesis.cancel();
            handleReadAlongEnd();
        }
    } else {
        currentReadAlongIndex = 0;
        startReadAlong();
    }
}

async function startReadAlong() {
    const text = dom.storyInput.value;
    if (!text.trim() || storyWordElements.length === 0) return;

    const mySession = ++readAlongSessionId;
    isReadingAlong = true;
    isReadAlongPaused = false;
    btnReadAlong.classList.add('speaking');
    btnReadAlong.querySelector('span').textContent = "🛑 Stop";
 // Process the story one sentence at a time
    while (isReadingAlong && currentReadAlongIndex < storyWordElements.length && mySession === readAlongSessionId) {
        const range = getNextSentenceRange(currentReadAlongIndex);
        await runSentenceRead(range, mySession);
        
        // Small pause between sentences for natural phrasing and resync
        if (isReadingAlong && !isReadAlongPaused) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    if (mySession === readAlongSessionId) {
        handleReadAlongEnd();
    }
}

/**
 * Identifies the range of words that make up the next sentence.
 */
function getNextSentenceRange(startIndex) {
    let endIndex = startIndex;
    for (let i = startIndex; i < storyWordElements.length; i++) {
        endIndex = i;
        const word = storyWordElements[i].textContent;
        // Sentence ends on punctuation or if it's the last word
        if (/[.!?]/.test(word) || i === storyWordElements.length - 1) {
            break;
        }
    }
    return { start: startIndex, end: endIndex };
}

/**
 * Reads a specific range of words as a single segment.
 */
async function runSentenceRead(range, sessionId) {
    const text = dom.storyInput.value;
    const firstWord = storyWordElements[range.start];
    const lastWord = storyWordElements[range.end];
    
    const startChar = parseInt(firstWord.dataset.start);
    const endChar = parseInt(lastWord.dataset.end);
    
    // Extract just this sentence, preserving character offsets via space-padding
    const sentenceText = text.substring(startChar, endChar).replace(/\[IMAGE:.*?\]/g, (m) => " ".repeat(m.length));

    await VoiceManager.speakText(sentenceText, null, (event) => {
        if (sessionId !== readAlongSessionId || isReadAlongPaused) return;
        
        if (event.name === 'word') {
            const relativeCharIndex = event.charIndex;
            const absoluteCharIndex = relativeCharIndex + startChar;

            // Search only within the active sentence range
            for (let i = range.start; i <= range.end; i++) {
                if (absoluteCharIndex >= storyWordMetadata[i].start && absoluteCharIndex < storyWordMetadata[i].end) {
                    if (i !== currentReadAlongIndex) {
                        currentReadAlongIndex = i;
                        requestAnimationFrame(() => highlightReadAlongWord(i));
                    }
                    break;
                }
            }
        }
    }, readingRate);
}

function highlightReadAlongWord(index) {
    const el = storyWordElements[index];
    if (!el || el === lastHighlightedReadAlongElement) return;

    // Optimized: Only remove highlight from the previously active element
    if (lastHighlightedReadAlongElement) {
        lastHighlightedReadAlongElement.classList.remove('read-along-highlight');
    }
    
    el.classList.add('read-along-highlight');
    lastHighlightedReadAlongElement = el;
    scrollToWord(el);
}

/**
 * Safely scrolls the reader view to center the specific word element.
 */
function scrollToWord(el) {
    if (!el) return;
    
    // Only scroll if the element is not clearly visible to reduce iPad jitter
    const rect = el.getBoundingClientRect();
    // Use a tighter "comfort zone" to prevent constant micro-scrolling
    const isVisible = (rect.top >= 150 && rect.bottom <= window.innerHeight - 150);
    
    if (!isVisible) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Toggles the pause state of the Story Teller.
 */
function toggleReadAlongPause() {
    if (!isReadingAlong) return;

    isReadAlongPaused = !isReadAlongPaused;
    
    if (isReadAlongPaused) {
        window.speechSynthesis.pause();
        if (btnReadAlong) btnReadAlong.querySelector('span').textContent = "▶️ Resume";
        toastManager.show('Story Teller paused. Click the story to resume.', 'info', 1500);
    } else {
        window.speechSynthesis.resume();
        if (btnReadAlong) btnReadAlong.querySelector('span').textContent = "🛑 Stop";
        toastManager.show('Resuming...', 'info', 1000);
    }
}

function handleReadAlongEnd() {
    // Only reset if we actually reached the end
    if (currentReadAlongIndex >= storyWordElements.length - 1) {
        currentReadAlongIndex = 0;

        // Ensure trailing content (like a final image) is scrolled into view
        if (dom.storyDisplay && dom.storyDisplay.lastElementChild) {
            dom.storyDisplay.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }
    isReadingAlong = false;
    isReadAlongPaused = false;
    if (btnReadAlong) {
        btnReadAlong.classList.remove('speaking');
        btnReadAlong.querySelector('span').textContent = "🔊 Story Teller";
    }
    if (lastHighlightedReadAlongElement) {
        lastHighlightedReadAlongElement.classList.remove('read-along-highlight');
        lastHighlightedReadAlongElement = null;
    }
}

function toggleReadAloud() {
    if (sttManager.isActive) {
        sttManager.stop();
    } else {
        lastProcessedTranscript = "";
        resetReadingPointer();
        sttManager.start();
        toastManager.show('Listening... Read the story out loud!', 'info');
    }
}

function handleSpeechStatusChange(isActive) {
    if (btnReadAloud) {
        btnReadAloud.classList.toggle('speaking', isActive);
        btnReadAloud.querySelector('span').textContent = isActive ? '🛑 Stop Karaoke' : '🎤 Karaoke Mode';
    }
    if (!isActive) lastProcessedTranscript = "";
    updateActiveHighlight();
}

/**
 * Resets the reading progress.
 */
function resetReadingPointer() {
    readingPointer = 0;
    lastProcessedTranscript = "";
    storyWordElements.forEach(el => {
        el.classList.remove('read-correct', 'read-skipped', 'read-help', 'read-active', 'read-misspoken');
    });
    updateActiveHighlight();
}

/**
 * Updates the visual "next word" highlight.
 */
function updateActiveHighlight() {
    storyWordElements.forEach(el => el.classList.remove('read-active'));
    if (sttManager && sttManager.isActive && readingPointer < storyWordElements.length) {
        const nextWord = storyWordElements[readingPointer];
        nextWord.classList.add('read-active');
        scrollToWord(nextWord);
    }
}

/**
 * Marks a word with a specific status class.
 */
function markWord(index, status) {
    const el = storyWordElements[index];
    if (!el) return;
    
    // Remove conflicting states
    el.classList.remove('read-correct', 'read-skipped', 'read-misspoken', 'read-help');
    
    if (status === 'correct') el.classList.add('read-correct');
    if (status === 'skipped') el.classList.add('read-skipped');
    if (status === 'misspoken') el.classList.add('read-misspoken');
}

/**
 * Normalizes text for fuzzy matching (lowercase, no punctuation).
 * @param {string} text 
 */
function cleanText(text) {
    return text.toLowerCase().replace(/[.,!?;:"()]/g, '').trim();
}

/**
 * Sets up all the event listeners for the application.
 */
function setupEventListeners() {
    const listeners = [
        // Main Controls
        { element: dom.creatorModeBtn, event: 'click', handler: toggleCreatorMode },

        // Dashboard
        { element: dom.clearStatsBtn, event: 'click', handler: clearAllStats },
        { element: dom.resetAppBtn, event: 'click', handler: resetApplication },

        // Story Modal
        { element: dom.loadFromUrlBtn, event: 'click', handler: handleLoadFromUrl },
        { element: dom.connectBtn, event: 'click', handler: handleConnectClick },
        { element: dom.refreshStoryListBtn, event: 'click', handler: loadStoryLibrary },
        { element: dom.storyList, event: 'click', handler: handleStoryListClick },

        // Creator Mode
        { element: dom.illustrateStoryBtn, event: 'click', handler: illustrateStoryWithGemini },
        { element: dom.magicImageBtn, event: 'click', handler: insertMagicImageAtCursor },
        { element: dom.addImageBtn, event: 'click', handler: addImageToStory },
        { element: dom.addPhoneticBtn, event: 'click', handler: () => addPhoneticPair() },
        { element: dom.phoneticsEditor, event: 'click', handler: handlePhoneticsEditorClick },
        { element: dom.addPronunciationBtn, event: 'click', handler: () => addPronunciationPair() },
        { element: dom.pronunciationsEditor, event: 'click', handler: handlePronunciationEditorClick },
        { element: dom.saveStoryBtn, event: 'click', handler: saveUserStory },

        // Sidenav / Settings
        { element: dom.btnGameMode, event: 'click', handler: () => GameUI.openGameSetSelector() },
        { element: dom.gameSetSelectXBtn, event: 'click', handler: () => dom.gameSetSelectModal.classList.add('hidden') },
        { element: dom.settingsVoiceSelection, event: 'change', handler: (e) => {
            const voiceName = e.target.value;
            localStorage.setItem(VoiceManager.VOICE_PREF_KEY, voiceName);
            toastManager.show('Voice saved!', 'success');
            
            const funPhrases = [
                "How now brown cow!",
                "Peter Piper picked a peck of pickled peppers.",
                "She sells seashells by the seashore.",
                "I am ready to help you read today!",
                "A big blue bear baked a batch of bread.",
                "Fuzzy Wuzzy was a bear, Fuzzy Wuzzy had no hair.",
                "I scream, you scream, we all scream for ice cream!",
                "Betty Botter bought some butter.",
                "Six slippery snails slid slowly seaward.",
                "Red lorry, yellow lorry, red lorry, yellow lorry.",
                "Double bubble gum, bubbles double."
            ];
            const randomPhrase = funPhrases[Math.floor(Math.random() * funPhrases.length)];
            VoiceManager.speakText(randomPhrase);
        }},
        { element: dom.gameSetSelectList, event: 'click', handler: (e) => GameUI.handleGameSetSelection(e) },
        { element: dom.confirmGameStartBtn, event: 'click', handler: () => GameUI.startSelectedGame() },
        { element: dom.addGameSetBtn, event: 'click', handler: () => GameUI.addNewGameSet() },
        { element: dom.gameSetEditorList, event: 'click', handler: (e) => GameUI.handleGameSetEditorAction(e) },
        { element: dom.gameSetEditorList, event: 'change', handler: (e) => GameUI.saveGameSetFromUI(e) },
        { element: dom.testApiKeyBtn, event: 'click', handler: testGeminiConnection },
        { element: dom.checkUpdatesBtn, event: 'click', handler: checkForUpdates },
        { element: dom.gameRepeatBtn, event: 'click', handler: () => VoiceManager.speakText(gameManager.state.targetWord) },
        { element: dom.celebDoneBtn, event: 'click', handler: () => {
            dom.celebrationModal.classList.add('hidden');
            uiManager.showView('reader');
        }},
        { element: dom.celebPlayAgainBtn, event: 'click', handler: () => {
            dom.celebrationModal.classList.add('hidden');
            GameUI.startSelectedGame();
        }},
    ];

    listeners.forEach(({ element, event, handler }) => {
        if (element) {
            element.addEventListener(event, handler);
        }
    });

    // Press and hold logic for syllable pop-up
    dom.storyDisplay.addEventListener('pointerdown', handlePressStart);
    dom.storyDisplay.addEventListener('pointermove', handlePointerMove);
    dom.storyDisplay.addEventListener('pointercancel', handlePressEnd);
    dom.storyDisplay.addEventListener('contextmenu', (e) => {
        // Prevent the system context menu on speakable words to allow the custom long-press syllable popup
        if (e.target.closest('.speakable-word')) e.preventDefault();
    });

    dom.gameGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.flash-card');
        if (!card || card.classList.contains('flipped')) return;
        
        const word = card.dataset.word;
        const index = parseInt(card.dataset.index);
        
        if (gameManager.handleChoice(word, index)) {
            GameUI.triggerCorrectEffect(card);
            card.classList.add('flipped');
            setTimeout(() => {
                GameUI.renderGameGrid();
                // Only speak the next word if the game is still active (hasn't ended)
                if (gameManager.state.active) {
                    VoiceManager.speakText(gameManager.state.targetWord);
                }
            }, 2000);
        }
    });

    dom.storyDisplay.addEventListener('click', (e) => {
        if (e.target.classList.contains('retry-image-btn')) {
            aiManager.retryGeneration(e.target.dataset.filename, sessionImages, localImageUrls);
        }
        
        // If the user clicks the story area while reading, toggle pause.
        // We check for !activeWordElement here to avoid double-toggling if they clicked a specific word.
        if (isReadingAlong && !e.target.closest('.speakable-word')) {
            toggleReadAlongPause();
        }
    });

    // Add listeners to the window to catch the end of a press anywhere
    window.addEventListener('pointerup', handlePressEnd);
}



/**
 * Maintenance utility to clean up unused image assets from IndexedDB.
 */
async function performStorageMaintenance() {
    console.log('Starting storage maintenance...');
    try {
        const deletedCount = await storyManager.cleanupOrphanedImages();
        if (deletedCount > 0) {
            console.log(`Storage maintenance complete. Cleaned up ${deletedCount} orphaned images.`);
        }
    } catch (error) {
        console.error('Storage maintenance failed:', error);
    }
}

/**
 * Handles the main connect button click.
 */
function handleConnectClick() {
    uiManager.closeNav();
    if (isPeerConnected) {
        if (confirm('Disconnect from peer?')) {
            peerService.destroyPeer();
            // UI update will be triggered by onConnectionStatusChange callback if modal was open,
            // but since modal is closed, we manually update or rely on peerService callback if we had a global listener.
            // Since we don't have a global listener, we update state here.
            isPeerConnected = false;
            chatManager.enable(false);
            dom.connectBtn.textContent = 'Connect';
            dom.connectBtn.classList.remove('connected');
            loadStoryLibrary(); // Refresh to hide share buttons
        }
    } else {
        showPeerConnectionModal(toastManager, {
            appPrefix: 'readinghelper',
            peerPrefix: 'readinghelper-',
            onDataReceived: (data, peerName) => {
                if (data.type === 'story-transfer') {
                    handleStoryTransfer(data);
                } else if (data.type === 'chat') {
                    chatManager.handleIncomingMessage(data.content, peerName || 'Peer');
                }
            },
            onConnectionChange: (connected) => {
                isPeerConnected = connected;
                chatManager.enable(connected);
                dom.connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
                dom.connectBtn.classList.toggle('connected', connected);
                loadStoryLibrary(); // Refresh to show/hide share buttons
            }
        });
    }
}

/**
 * Fetches the story manifest and populates the story selection modal.
 */
async function loadStoryLibrary() {
    await loadDefaultStories();
    await loadMyStories();
}

async function loadDefaultStories() {
    if (dom.storyList.querySelector('#default-stories-group')) return;

    try {
        const response = await fetch('stories.json');
        const stories = await response.json();
        
        const storiesHtml = stories.map(story => 
            `<div class="story-item" data-path="${story.path}">
                <span class="story-item-title">${story.title}</span>
            </div>`
        ).join('');

        const groupHtml = `
            <div id="default-stories-group" class="story-group">
                <div class="story-group-header">Read-Along Stories</div>
                <div class="story-group-content">${storiesHtml}</div>
            </div>
        `;
        dom.storyList.insertAdjacentHTML('beforeend', groupHtml);
    } catch (e) {
        console.error("Could not load default stories", e);
    }
}

/**
 * Finds stories in the 'my_stories' directory of the Origin Private File System.
 */
async function loadMyStories() {
    const localStories = storyManager.getUserStories();
    if (localStories.length > 0) {
        addLocalStoriesToModal(localStories);
    } else {
        const group = dom.storyList.querySelector('#local-stories-group');
        if (group) group.remove();
    }
}

/**
 * Adds a list of local stories to the UI.
 * @param {Array<object>} stories - An array of story objects with title and name properties.
 */
function addLocalStoriesToModal(stories) {
    let group = dom.storyList.querySelector('#local-stories-group');
    if (!group) {
        dom.storyList.insertAdjacentHTML('afterbegin', `
            <div id="local-stories-group" class="story-group">
                <div class="story-group-header">My Stories</div>
                <div class="story-group-content"></div>
            </div>
        `);
        group = dom.storyList.querySelector('#local-stories-group');
    }

    const contentArea = group.querySelector('.story-group-content');
    const newStoriesHtml = stories.map(story =>
        `<div class="story-item" data-local-story-id="${story.id}" data-title="${story.title}">
            <span class="story-item-title">${story.title}</span>
            <button class="theme-button story-share-btn" data-local-story-id="${story.id}" title="${isPeerConnected ? 'Share story' : 'Connect to a peer to share'}" ${isPeerConnected ? '' : 'disabled'}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                <span>Share</span>
            </button>
            <button class="theme-button story-delete-btn destructive" data-local-story-id="${story.id}" title="Delete story">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                <span>Delete</span>
            </button>
        </div>`
    ).join('');
    contentArea.innerHTML = newStoriesHtml; // Use innerHTML to replace content on refresh
}



/**
 * Tests the Google AI API key by making a simple request to the Gemini models endpoint.
 */
async function testGeminiConnection() {
    const apiKey = dom.googleApiKeyInput.value.trim() || localStorage.getItem('google_ai_api_key');
    await aiManager.testGeminiConnection(apiKey, dom.apiKeyStatus);
}

/**
 * Uses Google Gemini to analyze the entire story and rewrite it with illustrations.
 */
async function illustrateStoryWithGemini() {
    await aiManager.illustrateStory(dom.storyInput.value.trim(), (text) => {
        dom.storyInput.value = text;
        renderStory();
    }, sessionImages, localImageUrls);
}

/**
 * Uses Google Gemini to generate a single "Magic Image" based on selected text
 */
async function insertMagicImageAtCursor() {
    const start = dom.storyInput.selectionStart;
    const end = dom.storyInput.selectionEnd;
    const selectedText = dom.storyInput.value.substring(start, end).trim();
    
    const hiddenDetails = prompt("Art style or character details (e.g., 'Studio Ghibli style, Goldilocks wears a red ribbon'):") || "";
        
    await aiManager.insertMagicImage(dom.storyInput.value, start, end, hiddenDetails, (text) => {
        dom.storyInput.value = text;
        renderStory();
    }, sessionImages, localImageUrls);
}

/**
 * Renders the text from the input area into the story display area,
 * making each word interactive.
 */
function renderStory() {
    const text = dom.storyInput.value; // We still use storyInput as the source of truth
    const aiMetadata = aiManager.getMetadata();
    storyWordElements = [];
    let currentPos = 0;

    // Split by spaces and punctuation, but keep them for rendering.
    // This regex splits on spaces, newlines, and common punctuation.
    const parts = text.split(/(\[IMAGE:.*?\]|[ \n.,!?;:"()])/);
    const html = parts.map(part => {
        if (!part) return '';

        const start = currentPos;
        currentPos += part.length;

        // Check for our custom image tag
        const imageMatch = part.match(/^\[IMAGE:(.*?)\]$/);
        if (imageMatch) {
            const imageIdentifier = imageMatch[1].trim(); // This can be a path or an ai-gen-filename
            const isAiGenerated = imageIdentifier.startsWith('ai-gen-');
            const isFilePath = !isAiGenerated && /\.(jpg|jpeg|png|gif|webp)$/i.test(imageIdentifier);
            
            if (isFilePath) {
                const imageName = imageIdentifier.split('/').pop();
                const fullImagePath = localImageUrls[imageName] || `${currentStoryPath}${imageIdentifier}`.replace(/ /g, '%20');
                const titleAttr = isCreatorMode ? `title="${imageIdentifier}"` : '';
                return `<img src="${fullImagePath}" alt="Story illustration" class="story-image" ${titleAttr}>`;
            } else if (isAiGenerated) {
                const fileName = imageIdentifier;
                let metadata = aiMetadata[fileName];

                if (!metadata) {
                    // This can happen if a story is loaded with an AI tag but no metadata (e.g., manual edit or old save)
                    // Try to extract prompt from sessionImages if it was saved as Base64
                    const base64Data = sessionImages[fileName];
                    if (base64Data) {
                        // If we have base64, it's already a success
                        metadata = { prompt: "Loaded AI Image", status: 'success' };
                        aiMetadata[fileName] = metadata;
                        localImageUrls[fileName] = base64Data; // Ensure it's mapped for rendering
                    } else {
                        // If no metadata and no base64, it's a new pending generation
                        metadata = { prompt: "AI Image", status: 'pending' }; // Default prompt
                        aiMetadata[fileName] = metadata;
                    }
                }

                if (metadata.status === 'success') {
                    const titleAttr = isCreatorMode ? `title="${metadata.prompt}"` : '';
                    return `<img src="${localImageUrls[fileName]}" alt="${metadata.prompt}" class="story-image" ${titleAttr}>`;
                } else if (metadata.status === 'generating') {
                    return `<div id="${fileName}" class="ai-prompt-placeholder generating" title="Drawing: ${metadata.prompt}"><div class="spinner"></div><span>Drawing: <i>${metadata.prompt}</i></span></div>`;
                } else if (metadata.status === 'failed') {
                    // Only show technical error and retry button if in Creator Mode. 
                    // For the reader, show a generic message or nothing.
                    const retryBtn = isCreatorMode ? `<button class="retry-image-btn" data-filename="${fileName}">Retry</button>` : '';
                    
                    let errorText = 'The AI illustrator is taking a short break.';
                    if (metadata.errorCode === 429) {
                        errorText = "The AI artist is taking a break! Check back in a few minutes.";
                    } else if (metadata.errorCode === 403) {
                        errorText = "The AI couldn't quite see that picture. Let's try another word!";
                    } else if (isCreatorMode) {
                        errorText = `Failed: ${metadata.errorMessage || 'Unknown error'}`;
                    }

                    const errorIcon = metadata.errorCode === 403 ? '🎨 ' : (isCreatorMode ? '❌ ' : '🎨 ');
                    
                    return `<div id="${fileName}" class="ai-prompt-placeholder failed" title="${metadata.errorMessage || 'Unknown error'}"><span>${errorIcon}${errorText}</span>${retryBtn}</div>`;
                } else { // pending or unknown
                    // Only show "Generate Now" button if in Creator Mode.
                    const generateBtn = isCreatorMode ? `<button class="retry-image-btn" data-filename="${fileName}">Generate Now</button>` : '';
                    const pendingText = isCreatorMode ? `Pending: ${metadata.prompt}` : 'An illustration is coming soon!';
                    return `<div id="${fileName}" class="ai-prompt-placeholder pending" title="${metadata.prompt}"><div class="spinner"></div><span>${pendingText}</span>${generateBtn}</div>`;
                }
            } else {
                // This is a text prompt that is not an AI-generated filename.
                // This case should ideally not happen if the AI generation process is complete.
                // For now, treat it as a generic prompt placeholder.
                return `<div class="ai-prompt-placeholder" title="AI Image Prompt: ${imageIdentifier}">🎨 <i>${imageIdentifier}</i></div>`;
            }
        }

        // Check if the part is a word (contains letters)
        if (/[a-zA-Z']/.test(part) && /[a-zA-Z]/.test(part)) { // Must contain letters, can contain apostrophes
            const span = document.createElement('span');
            span.className = 'speakable-word';
            span.textContent = part;
            span.dataset.start = start;
            span.dataset.end = start + part.length;
            return span.outerHTML;
        } else {
            // It's whitespace or punctuation, return as is.
            return part;
        }
    }).join('');

    dom.storyDisplay.innerHTML = html;
    // Map the spans back to an array for the reading pointer
    storyWordElements = Array.from(dom.storyDisplay.querySelectorAll('.speakable-word'));
    // Cache numeric ranges to avoid expensive parseInt calls during high-frequency TTS events
    storyWordMetadata = storyWordElements.map(el => ({
        start: parseInt(el.dataset.start),
        end: parseInt(el.dataset.end)
    }));
    updateActiveHighlight();
}

/**
 * Core logic for the Sequential Word Matching.
 */
function handleSpeechResult({ final, interim }) {
    const transcript = (final || interim).toLowerCase();
    if (!transcript || readingPointer >= storyWordElements.length) return;

    // Only process the part of the transcript we haven't seen yet in this segment
    let newPart = transcript;
    if (transcript.startsWith(lastProcessedTranscript)) {
        newPart = transcript.substring(lastProcessedTranscript.length).trim();
    }
    
    if (final) {
        lastProcessedTranscript = ""; // Reset for next sentence
    } else {
        lastProcessedTranscript = transcript;
    }

    if (!newPart) return;

    const spokenWords = newPart.split(/\s+/);
    
    spokenWords.forEach(spoken => {
        const cleanedSpoken = cleanText(spoken);
        if (!cleanedSpoken) return;

        // 1. Check current word (Success)
        const currentExpected = cleanText(storyWordElements[readingPointer].textContent);
        if (cleanedSpoken === currentExpected) {
            markWord(readingPointer, 'correct');
            readingPointer++;
            updateActiveHighlight();
            return;
        }

        // 2. Check Backtracking (Correction window: 3 words back)
        const backLimit = Math.max(0, readingPointer - 3);
        for (let i = readingPointer - 1; i >= backLimit; i--) {
            if (cleanedSpoken === cleanText(storyWordElements[i].textContent)) {
                markWord(i, 'correct');
                // Clear error/skipped marks for everything we just "re-read"
                for (let j = i + 1; j < readingPointer; j++) {
                    storyWordElements[j].classList.remove('read-correct', 'read-skipped', 'read-misspoken');
                }
                readingPointer = i + 1;
                updateActiveHighlight();
                return;
            }
        }

        // 3. Check Look Ahead (Skipping window: 5 words ahead)
        const forwardLimit = Math.min(readingPointer + 5, storyWordElements.length);
        for (let i = readingPointer + 1; i < forwardLimit; i++) {
            if (cleanedSpoken === cleanText(storyWordElements[i].textContent)) {
                // User skipped some words
                for (let j = readingPointer; j < i; j++) {
                    markWord(j, 'skipped');
                }
                markWord(i, 'correct');
                readingPointer = i + 1;
                updateActiveHighlight();
                return;
            }
        }

        // 4. If we are here, the word didn't match current, back, or forward.
        // It is likely a misspoken word at the current pointer.
        markWord(readingPointer, 'misspoken');
    });

    // If the user finished the story
    if (readingPointer === storyWordElements.length && final) {
        sttManager.stop();
        setTimeout(() => {
            VoiceManager.speakText("You read the whole story! Well done!");
        }, 500);
    }
}

/**
 * A simple algorithm to break a word into syllables.
 * This is a heuristic and may not be perfect for all English words.
 * @param {string} word The word to syllabify.
 * @returns {string} The word with dashes between syllables.
 */
function getSyllables(word) {
    const lowerCaseWord = word.toLowerCase();
    // Prioritize the phonetic dictionary first.
    if (currentPhonetics[lowerCaseWord]) {
        return currentPhonetics[lowerCaseWord];
    }

    // This is a more robust heuristic for syllable counting in English.
    word = word.toLowerCase();
    if (word.length <= 3) {
        return word;
    }

    const VOWELS = /[aeiouy]{1,2}/g;
    const matches = word.match(VOWELS);

    if (!matches || matches.length <= 1) {
        return word; // Cannot be split if there's one vowel group or less
    }

    // A simple heuristic: split between consonants surrounded by vowels.
    // VCV -> V-CV (e.g., "a-way")
    // VCCV -> VC-CV (e.g., "win-ter")
    let result = [];
    let lastIndex = 0;

    word.replace(/([aeiouy])([bcdfghjklmnpqrstvwxz]{2,})([aeiouy])/g, (match, p1, p2, p3, offset) => {
        result.push(word.substring(lastIndex, offset + 1));
        result.push(p2.substring(0, 1));
        lastIndex = offset + 1 + 1;
    });

    if (lastIndex < word.length) {
        result.push(word.substring(lastIndex));
    }

    // This is a simplified approach; for a truly accurate result, a dictionary-based method is needed.
    // For now, we'll join what we have. This logic is much better than before.
    // A more visual split can be achieved by re-inserting dashes.
    return word.replace(/([aeiouy])([bcdfghjklmnpqrstvwxz])([aeiouy])/g, '$1-$2$3')
               .replace(/([bcdfghjklmnpqrstvwxz])([bcdfghjklmnpqrstvwxz])([aeiouy])/g, '$1-$2$3');
}

/**
 * Uses the Web Speech API to read a word aloud.
 * @param {string} text The text to speak.
 */
function speakWordFromStory(text) {
    const lowerCaseText = text.toLowerCase();
    let textToSpeak = text;
    
    const tappedIndex = storyWordElements.indexOf(activeWordElement);

    // Check if there's a pronunciation override for this word.
    if (currentPronunciations[lowerCaseText]) {
        textToSpeak = currentPronunciations[lowerCaseText];
    }
    
    const elementToHighlight = activeWordElement;

    // Integration with Reading Pointer: If they tap a word for help, mark it.
    if (sttManager && sttManager.isActive && activeWordElement) {
        markWord(tappedIndex, 'help');
        // Advance the pointer to the word immediately after the one they needed help with
        readingPointer = tappedIndex + 1;
        updateActiveHighlight();
    }

    VoiceManager.speakText(textToSpeak, elementToHighlight, null, readingRate);
}

/**
 * Plays a procedural beep for game interaction using the Web Audio API.
 */
function playGameSound(frequency, duration, type = 'sine') {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
        
        // Simple volume envelope to avoid clicking sounds
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
        
        setTimeout(() => audioCtx.close(), duration * 1000 + 100);
    } catch (e) { /* Audio fallback */ }
}

/**
 * Increments the count for a tapped word in localStorage.
 * @param {string} word The word that was tapped.
 */
function trackWord(word) {
    const stats = loadWordStats();
    stats[word] = (stats[word] || 0) + 1;
    localStorage.setItem(WORD_STATS_KEY, JSON.stringify(stats));
    renderDashboard(); // Update dashboard in real-time
}

/**
 * Loads the word statistics from localStorage.
 * @returns {object} The word statistics object.
 */
function loadWordStats() {
    const statsJSON = localStorage.getItem(WORD_STATS_KEY);
    return statsJSON ? JSON.parse(statsJSON) : {};
}

/**
 * Renders the "Tricky Words" dashboard.
 */
function renderDashboard() {
    const stats = loadWordStats();
    const sortedWords = Object.entries(stats).sort(([, a], [, b]) => b - a);

    dom.trickyWordsList.innerHTML = sortedWords.map(([word, count]) => `
        <div class="tricky-word-item">
            <span class="word">${word}</span>
            <span class="count">${count}</span>
        </div>
    `).join('');
}



/**
 * Clears all tracked word statistics from localStorage.
 */
function clearAllStats() {
    if (confirm('Are you sure you want to clear all word statistics? This cannot be undone.')) {
        localStorage.removeItem(WORD_STATS_KEY);
        renderDashboard();
    }
}

/**
 * Toggles the Story Creator mode.
 */
function toggleCreatorMode() {
    isCreatorMode = !isCreatorMode;
    dom.creatorArea.classList.toggle('hidden', !isCreatorMode);

    if (isCreatorMode) {
        dom.creatorModeBtn.querySelector('span').textContent = 'Exit Creator Mode';
        // If dashboard is not hidden, switch back to reader view to show the creator
        if (!dom.dashboardView.classList.contains('hidden')) {
            uiManager.toggleDashboard();
        }

        dom.storyInput.addEventListener('input', handleStoryInputPreview);
        renderStory();
        renderPhoneticsEditor(); // Clear and render the phonetics editor
        renderPronunciationEditor(); // Clear and render the editor
    } else {
        dom.creatorModeBtn.querySelector('span').textContent = 'Enter Creator Mode';
        dom.storyInput.removeEventListener('input', handleStoryInputPreview);
        renderStory(); // Render whatever is in the text area when exiting
    }
}




/**
 * Handles clicks within the story list, delegating to either expand/collapse
 * a group or select a story.
 * @param {Event} event The click event.
 */
async function handleStoryListClick(event) {
    const target = event.target;

    if (target.classList.contains('story-group-header')) {
        const isCollapsed = target.classList.contains('collapsed');

        // Collapse all groups first
        dom.storyList.querySelectorAll('.story-group-header').forEach(header => {
            header.classList.add('collapsed');
            header.nextElementSibling.classList.add('hidden');
        });

        // If the clicked group was collapsed, expand it.
        // This makes it so clicking an already open group will just close it.
        target.classList.toggle('collapsed', !isCollapsed);
        const content = target.nextElementSibling;
        content.classList.toggle('hidden', !isCollapsed);
    } else if (target.closest('.story-delete-btn')) {
        const btn = target.closest('.story-delete-btn');
        const storyTitle = btn.closest('.story-item').querySelector('.story-item-title').textContent;
        if (btn.dataset.localStoryId) {
            deleteMyStory(btn.dataset.localStoryId, storyTitle);
        }
    } else if (target.closest('.story-share-btn')) {
        const btn = target.closest('.story-share-btn');
        const storyId = btn.dataset.localStoryId;
        const storyTitle = btn.closest('.story-item').querySelector('.story-item-title').textContent;
        shareStory(storyId, storyTitle);
    } else if (target.closest('[data-local-story-id]')) {
        const storyId = target.closest('[data-local-story-id]').dataset.localStoryId;
        await loadUserStory(storyId);
    } else if (target.closest('[data-path]')) {
        const storyItem = target.closest('.story-item');
        const path = storyItem.dataset.path;
        currentStoryPath = path; // Store the base path for the loaded story

        localImageUrls = {}; // Clear local images when loading a built-in story
        sessionImages = {}; // Clear session images

        // CRITICAL: Clear previous guides from memory before fetching new ones.
        currentStoryId = null;
        currentPhonetics = {};
        currentPronunciations = {};

        // Fetch all parts of the story module
        try {
            // Helper to safely fetch JSON, returning empty object on failure (404 or parsing)
            const fetchJsonSafe = (url) => fetch(url)
                .then(res => res.ok ? res.json() : {})
                .catch(() => ({}));

            const [storyResponse, phoneticsData, pronunciationsData] = await Promise.all([
                fetch(`${path}story.txt`),
                fetchJsonSafe(`${path}phonetics.json`),
                fetchJsonSafe(`${path}pronunciations.json`)
            ]);

            if (!storyResponse.ok) throw new Error('Story file not found');
            const storyText = await storyResponse.text();
            
            currentPhonetics = phoneticsData;
            currentPronunciations = pronunciationsData;

            dom.storyInput.value = storyText;

            // Ingest images to make the built-in story portable for "Saving"
            const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
            let match;
            const matches = [...storyText.matchAll(imageRegex)];
            for (const match of matches) {
                const imageIdentifier = match[1].trim();
                const isFilePath = !imageIdentifier.startsWith('ai-gen-') && /\.(jpg|jpeg|png|gif|webp)$/i.test(imageIdentifier);
                
                if (isFilePath) {
                    const imageName = imageIdentifier.split('/').pop();
                    const fullImagePath = `${path}${imageIdentifier}`.replace(/ /g, '%20');
                    try {
                        const imgRes = await fetch(fullImagePath);
                        if (imgRes.ok) {
                            const blob = await imgRes.blob();
                            const base64 = await new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result);
                                reader.readAsDataURL(blob);
                            });
                            sessionImages[imageName] = base64;
                            localImageUrls[imageName] = base64;
                        }
                    } catch (e) {
                        console.warn(`[INGEST] Failed to pre-load built-in image: ${fullImagePath}`, e);
                    }
                }
            }

            // Also populate the creator editors so the user can see the loaded guides.
            renderPhoneticsEditor(currentPhonetics);
            renderPronunciationEditor(currentPronunciations);

            uiManager.closeStoryModal();
            renderStory(); // Automatically load the story
        } catch (error) {
            console.error(`Failed to load story module from ${path}`, error);
            alert('Could not load the selected story.');
        }
    }
}

/**
 * Handles loading a story from a provided URL.
 */
async function handleLoadFromUrl() {
    let baseUrl = prompt('Please enter the URL to the story folder:', 'https://rahbster.github.io/ReadingHelper/');

    if (!baseUrl) {
        // User cancelled the prompt
        return;
    }

    // Ensure the base URL ends with a slash
    if (!baseUrl.endsWith('/')) {
        baseUrl += '/';
    }

    const libraryUrl = new URL('stories.json', baseUrl).href;

    try {
        // First, collapse all existing groups
        dom.storyList.querySelectorAll('.story-group-header').forEach(header => {
            header.classList.add('collapsed');
            header.nextElementSibling.classList.add('hidden');
        });

        const response = await fetch(libraryUrl);
        if (!response.ok) throw new Error(`Failed to fetch story library from ${libraryUrl}`);

        const stories = await response.json();
        if (!Array.isArray(stories)) throw new Error('The provided URL did not point to a valid story library array.');

        // Create the HTML for the new stories and append it to the list.
        const newStoriesHtml = stories.map(story => {
            // The full path to the story's folder is the base URL of the library + the story's relative path.
            const fullStoryPath = new URL(story.path, baseUrl).href;
            return `<div class="story-item" data-path="${fullStoryPath}"><span class="story-item-title">${story.title}</span></div>`;
        }).join('');

        const groupHostname = new URL(baseUrl).hostname;

        // Check if a group from this source already exists and remove it.
        const existingGroup = dom.storyList.querySelector(`.story-group[data-source="${groupHostname}"]`);
        if (existingGroup) {
            existingGroup.remove();
        }

        const newGroupHtml = `
            <div class="story-group" data-source="${groupHostname}">
                <div class="story-group-header">${groupHostname}</div>
                <div class="story-group-content">${newStoriesHtml}</div>
            </div>
        `;

        dom.storyList.insertAdjacentHTML('beforeend', newGroupHtml);
        alert(`${stories.length} stories from the web have been added to the list.`);

    } catch (error) {
        console.error('Error loading story from URL:', error);
        alert(`Could not load the story from the URL. Please check the URL and try again. Error: ${error.message}`);
    }
}

/**
 * Handles an incoming story package from a peer.
 * @param {object} storyPackage - The story data package.
 */
async function handleStoryTransfer(storyPackage) {
    if (storyPackage.type !== 'story-transfer') return;

    const storyTitle = storyPackage.title;

    try {
        // Construct the story object for localStorage
        const story = {
            title: storyTitle,
            content: storyPackage.files['story.txt'] || '',
            phonetics: {},
            pronunciations: {},
            images: {}
        };

        // Parse optional JSON files
        if (storyPackage.files['phonetics.json']) {
            try {
                story.phonetics = JSON.parse(storyPackage.files['phonetics.json']);
            } catch (e) { console.warn('Invalid phonetics JSON'); }
        }
        if (storyPackage.files['pronunciations.json']) {
            try {
                story.pronunciations = JSON.parse(storyPackage.files['pronunciations.json']);
            } catch (e) { console.warn('Invalid pronunciations JSON'); }
        }

        // Extract images
        for (const [path, data] of Object.entries(storyPackage.files)) {
            if (path.startsWith('images/')) {
                const imageName = path.split('/').pop();
                story.images[imageName] = data;
            }
        }

        // Save using the manager
        await storyManager.saveUserStory(story);

        toastManager.show(`Received story: "${storyTitle}". Saved to My Stories.`, 'success', 5000);
        
        // Refresh library to show the new story
        await loadStoryLibrary();

    } catch (error) {
        console.error('Error receiving or saving story:', error);
        toastManager.show('Failed to save received story.', 'error');
    }
}

/**
 * Packages and sends a story to the connected peer.
 * @param {string} storyId - The ID of the local story to share.
 * @param {string} storyTitle - The title of the story.
 */
async function shareStory(storyId, storyTitle) {    
    const story = await storyManager.getUserStoryById(storyId);
    if (!story) {
        alert('Could not find the story to share.');
        return;
    }
    console.log(`Packaging story: ${storyTitle} from localStorage.`);

    try {
        const storyPackage = {
            type: 'story-transfer',
            title: storyTitle,
            files: {}
        };

        // 1. Add core files
        storyPackage.files['story.txt'] = story.content;
        if (story.phonetics) storyPackage.files['phonetics.json'] = JSON.stringify(story.phonetics);
        if (story.pronunciations) storyPackage.files['pronunciations.json'] = JSON.stringify(story.pronunciations);

        // 2. Add images
        if (story.images) {
            for (const [name, base64] of Object.entries(story.images)) {
                // We store them as 'images/name' in the package to match the expected structure
                storyPackage.files[`images/${name}`] = base64;
            }
        }

        // 3. Send the complete package
        peerService.sendData(storyPackage);
        toastManager.show(`Story "${storyTitle}" has been sent!`, 'success');

    } catch (error) {
        console.error('Error packaging or sending story:', error);
        toastManager.show('Could not share the story.', 'error');
    }
}

/**
 * Loads a user story from localStorage.
 * @param {string} id - The ID of the story to load.
 */
async function loadUserStory(id) {
    const story = await storyManager.getUserStoryById(id);
    if (!story) return;

    currentStoryId = story.id;
    currentStoryPath = '';

    dom.storyInput.value = story.content;

    renderPhoneticsEditor(story.phonetics || {});
    renderPronunciationEditor(story.pronunciations || {});

    localImageUrls = {}; // Clear local image URLs
    sessionImages = {}; // Clear session images (will be repopulated from story.images)
    aiManager.clearMetadata();

    if (story.images) {
        for (const [name, base64] of Object.entries(story.images)) {
            sessionImages[name] = base64; // Store Base64 data for both uploaded and generated images
            localImageUrls[name] = base64; // Map Base64 for the renderer
        }
    }
    if (story.aiImageMetadata) {
        aiManager.setMetadata(story.aiImageMetadata);
        // Resume any pending or failed AI generations
        aiManager.resumeQueue(sessionImages, localImageUrls);
    }

    uiManager.closeStoryModal();
    renderStory();
}

/**
 * Displays a pop-up with the syllabified word near the target element.
 * @param {string} word The word to display.
 * @param {HTMLElement} targetElement The element that was clicked.
 */
function showSyllablePopup(word, targetElement) {
    popupWasShown = false; // Reset the flag at the start
    const popup = dom.syllablePopup;
    const syllabifiedWord = VoiceManager.getSyllables(word.trim(), currentPhonetics);

    // Don't show pop-up if the word couldn't be split
    if (syllabifiedWord === word.toLowerCase()) {
        return;
    }

    popup.textContent = syllabifiedWord;
    popup.classList.remove('hidden'); // Make it part of the layout

    const rect = targetElement.getBoundingClientRect();

    // Position the pop-up above the clicked word, ensuring it doesn't go off-screen.
    popup.style.top = `${rect.top + window.scrollY - popup.offsetHeight - 10}px`;
    let left = rect.left + window.scrollX + (rect.width / 2) - (popup.offsetWidth / 2);
    left = Math.max(10, Math.min(left, window.innerWidth - popup.offsetWidth - 10)); // Clamp to viewport
    popup.style.left = `${left}px`;

    // Add 'show' class to trigger the fade-in animation
    requestAnimationFrame(() => popup.classList.add('show'));
    popupWasShown = true; // Set the flag since we are showing the popup
}

/**
 * Hides the syllable pop-up with a fade-out animation.
 */
function hideSyllablePopup() {
    const popup = dom.syllablePopup;
    popup.classList.remove('show');
    // Wait for the fade-out transition to finish before hiding it completely
    popup.addEventListener('transitionend', () => popup.classList.add('hidden'), { once: true });
}

/**
 * Handles the start of a press (mousedown or touchstart) on a word.
 * @param {Event} event The mousedown or touchstart event.
 */
function handlePressStart(event) {
    activeWordElement = event.target.closest('.speakable-word');
    if (!activeWordElement) return;

    touchStartX = event.clientX;
    touchStartY = event.clientY;

    isLongPress = false; // Reset flag
    popupWasShown = false; // Reset this flag on every new press
    pressTimer = setTimeout(() => {
        isLongPress = true;
        const originalWord = activeWordElement.textContent;
        showSyllablePopup(originalWord, activeWordElement);
    }, LONG_PRESS_DURATION);
}

/**
 * Handles movement to detect dragging/scrolling.
 * If the pointer moves more than a small threshold, we cancel the tap/long-press.
 * @param {PointerEvent} event 
 */
function handlePointerMove(event) {
    if (!pressTimer || !activeWordElement) return;

    const deltaX = Math.abs(event.clientX - touchStartX);
    const deltaY = Math.abs(event.clientY - touchStartY);

    // Threshold of 10 pixels to distinguish a tap from a scroll/swipe
    if (deltaX > 10 || deltaY > 10) {
        clearTimeout(pressTimer);
        pressTimer = null;
        activeWordElement = null;
    }
}

/**
 * Handles the end of a press anywhere on the page.
 * @param {Event} event The mouseup or touchend event.
 */
function handlePressEnd(event) {
    // If the timer is still running, it means it was a short press (a tap).
    // If the timer has already fired, `isLongPress` will be true.
    const wasShortPress = pressTimer !== null;
    clearTimeout(pressTimer);
    pressTimer = null;

    // If a long press happened AND it resulted in a popup being shown, hide it gracefully.
    if (isLongPress && popupWasShown) {
        setTimeout(hideSyllablePopup, 300);
    } 
    // If it was a short press AND the press started on a valid word element, process it as a tap.
    else if (wasShortPress && activeWordElement) { // This correctly identifies a tap
        if (isReadingAlong) {
            toggleReadAlongPause();
        } else {
        const word = activeWordElement.textContent.trim().toLowerCase();
        speakWordFromStory(word);
        trackWord(word);
        }
    }

    activeWordElement = null; // Reset the active element
    isLongPress = false;      // CRITICAL FIX: Reset the long press flag after every interaction.
}

/**
 * Renders the interactive phonetics editor from an object.
 * @param {object} [phonetics={}] - The phonetics object to render.
 */
function renderPhoneticsEditor(phonetics = {}) {
    currentPhonetics = phonetics;
    dom.phoneticsEditor.innerHTML = Object.entries(phonetics).map(([word, replacement]) => {
        return `
            <div class="phonetic-pair">
                <input type="text" class="original-word" value="${word}" placeholder="Original word">
                <span class="arrow">→</span>
                <input type="text" class="replacement-word" value="${replacement}" placeholder="syl-la-bles">
                <div class="pair-controls">
                    <button class="remove-btn" title="Remove this pair">❌</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Adds a new, empty row to the phonetics editor.
 */
function addPhoneticPair() {
    const pairHtml = `
        <div class="phonetic-pair">
            <input type="text" class="original-word" placeholder="Original word">
            <span class="arrow">→</span>
            <input type="text" class="replacement-word" placeholder="syl-la-bles">
            <div class="pair-controls">
                <button class="remove-btn" title="Remove this pair">❌</button>
            </div>
        </div>
    `;
    dom.phoneticsEditor.insertAdjacentHTML('beforeend', pairHtml);
}

/**
 * Handles clicks inside the phonetics editor to remove a pair.
 * @param {Event} event The click event.
 */
function handlePhoneticsEditorClick(event) {
    const target = event.target;
    const pairElement = target.closest('.phonetic-pair');
    if (!pairElement) return;

    if (target.classList.contains('remove-btn')) {
        pairElement.remove();
    }
}

/**
 * Renders the interactive pronunciation editor from an object.
 * @param {object} [pronunciations={}] - The pronunciations object to render.
 */
function renderPronunciationEditor(pronunciations = {}) {
    currentPronunciations = pronunciations;
    dom.pronunciationsEditor.innerHTML = Object.entries(pronunciations).map(([word, replacement]) => {
        return `
            <div class="pronunciation-pair">
                <input type="text" class="original-word" value="${word}" placeholder="Original word">
                <span class="arrow">→</span>
                <input type="text" class="replacement-word" value="${replacement}" placeholder="How to say it">
                <div class="pair-controls">
                    <button class="speak-btn" title="Speak this pronunciation">🔊</button>
                    <button class="remove-btn" title="Remove this pair">❌</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Adds a new, empty row to the pronunciation editor.
 */
function addPronunciationPair() {
    const pairHtml = `
        <div class="pronunciation-pair">
            <input type="text" class="original-word" placeholder="Original word">
            <span class="arrow">→</span>
            <input type="text" class="replacement-word" placeholder="How to say it">
            <div class="pair-controls">
                <button class="speak-btn" title="Speak this pronunciation">🔊</button>
                <button class="remove-btn" title="Remove this pair">❌</button>
            </div>
        </div>
    `;
    dom.pronunciationsEditor.insertAdjacentHTML('beforeend', pairHtml);
}

/**
 * Handles clicks inside the pronunciation editor for speak and remove buttons.
 * @param {Event} event The click event.
 */
function handlePronunciationEditorClick(event) {
    const target = event.target;
    const pairElement = target.closest('.pronunciation-pair');
    if (!pairElement) return;

    if (target.classList.contains('speak-btn')) {
        const replacementInput = pairElement.querySelector('.replacement-word');
        const textToSpeak = replacementInput.value.trim();
        if (textToSpeak) {
            VoiceManager.speakText(textToSpeak);
        }
    } else if (target.classList.contains('remove-btn')) {
        pairElement.remove();
    }
}

/**
 * Handles adding an image to the story text area.
 * Uses the File System Access API to get a handle to a directory.
 */
async function addImageToStory() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result;
            const fileName = file.name;
            sessionImages[fileName] = base64;
            localImageUrls[fileName] = base64; // Map Base64 for the renderer

            // Insert tag
            const imageTag = `[IMAGE: ${fileName}]`;
            const { selectionStart, selectionEnd, value } = dom.storyInput;
            dom.storyInput.value = value.slice(0, selectionStart) + imageTag + value.slice(selectionEnd);
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

/**
 * Saves the user-created story to the 'user_stories' directory.
 */
async function saveUserStory() {
    const storyText = dom.storyInput.value.trim();
    if (!storyText) {
        alert('Please write a story before saving.');
        return;
    }

    const phoneticsObj = {};
    dom.phoneticsEditor.querySelectorAll('.phonetic-pair').forEach(pair => {
        const original = pair.querySelector('.original-word').value.trim().toLowerCase();
        const replacement = pair.querySelector('.replacement-word').value.trim();
        if (original && replacement) {
            phoneticsObj[original] = replacement;
        }
    });
    const phoneticsContent = JSON.stringify(phoneticsObj, null, 2);

    // Build the pronunciations object from the interactive editor
    const pronunciationsObj = {};
    dom.pronunciationsEditor.querySelectorAll('.pronunciation-pair').forEach(pair => {
        const original = pair.querySelector('.original-word').value.trim().toLowerCase();
        const replacement = pair.querySelector('.replacement-word').value.trim();
        if (original && replacement) {
            pronunciationsObj[original] = replacement;
        }
    });
    const pronunciationsContent = JSON.stringify(pronunciationsObj, null, 2);

    try {
        const title = prompt('Please enter a title for your story:', currentStoryId ? storyManager.getUserStoryById(currentStoryId)?.title : '');
        if (!title) return; // User cancelled

        const story = {
            title: title,
            content: storyText,
            phonetics: phoneticsObj,
            pronunciations: pronunciationsObj,
            images: {}
        };

        if (currentStoryId) {
            story.id = currentStoryId;
            // Preserve existing images if not overwritten
            const existing = await storyManager.getUserStoryById(currentStoryId);
            if (existing && existing.images) {
                story.images = { ...existing.images };
            }
        }

        // Process images in text
        const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
        let match;
        // Iterate through sessionImages to save all generated/uploaded images
        // sessionImages now contains both user-uploaded (by filename) and AI-generated (by uniqueId) Base64 data.
        for (const imageName in sessionImages) {
            if (sessionImages.hasOwnProperty(imageName)) {
                story.images[imageName] = sessionImages[imageName]; // Save the Base64 data
            }
        }
        
        // Save AI image metadata from the manager to ensure persistence
        const aiMetadata = aiManager.getMetadata();
        if (Object.keys(aiMetadata).length > 0) {
            story.aiImageMetadata = aiMetadata;
        }

        const savedStory = await storyManager.saveUserStory(story);
        // Update current ID if it was a new story
        if (savedStory?.id) currentStoryId = savedStory.id;

        alert(`Story "${title}" saved successfully!`);
        await loadStoryLibrary(); // Refresh list
    } catch (error) {
        console.error('Error saving story:', error);
        alert('Could not save the story.');
    }
}

/**
 * Deletes a user-created story from the Origin Private File System.
 * @param {string} storyId - The ID of the story to delete.
 * @param {string} storyTitle - The display title of the story for the confirmation prompt.
 */
async function deleteMyStory(storyId, storyTitle) {
    if (!confirm(`Are you sure you want to permanently delete your story "${storyTitle}"?`)) {
        return;
    }

    await storyManager.deleteUserStory(storyId);
    await loadStoryLibrary();
}

// Pre-load voices so they are ready when the user clicks
if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.getVoices();
            VoiceManager.populateVoiceList(dom.settingsVoiceSelection);
        };
    }
}


// Initialize the application
init();
