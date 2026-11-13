import * as peerService from './peer-service.js';
import * as storyManager from '../story-manager.js';
import { ImageStorage } from './storage-helper.js';
import { ToastManager } from './ToastManager.js';
import { ChatManager } from './ChatManager.js';
import { showPeerConnectionModal } from './modals/peer_connection_modal.js';
import * as aiManager from './ai-manager.js';
import { UIManager } from './UIManager.js';
import { GameManager } from './GameManager.js';
import * as VoiceManager from './VoiceManager.js';
import { SpeechRecognitionManager } from './SpeechRecognitionManager.js';
import * as GameUI from './GameUI.js';
import { buildStoryHtml, computeNextSentenceRange } from './ReaderEngine.js';
import { KaraokeSession } from './KaraokeMatcher.js';
import { playGameCorrectSound, playGameWrongSound } from './sound-effects.js';
import {
    escapeHtml,
    cleanWordToken,
    closeDialog,
    showConfirmModal,
    showPromptModal,
    prefersReducedMotion,
    requireParentGate
} from './utils/dom-utils.js';

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
    practiceTrickyBtn: document.getElementById('practice-tricky-btn'),
    clearStatsBtn: document.getElementById('clear-stats-btn'),
    resetAppBtn: document.getElementById('reset-app-btn'),
    // Preview banner (for incoming P2P shared stories)
    previewBanner: document.getElementById('preview-banner'),
    previewBannerText: document.getElementById('preview-banner-text'),
    previewAcceptBtn: document.getElementById('preview-accept-btn'),
    previewDeclineBtn: document.getElementById('preview-decline-btn'),
    // Modal elements
    syllablePopup: document.getElementById('syllable-popup'),
    storyModal: document.getElementById('story-modal'),
    storyList: document.getElementById('story-list'),
    storyModalXBtn: document.getElementById('story-modal-x-btn'),
    refreshStoryListBtn: document.getElementById('refresh-story-list-btn'),
    loadFromUrlBtn: document.getElementById('load-from-url-btn'),
    connectBtn: document.getElementById('connect-btn'),
    peerCountBadge: document.getElementById('peer-count-badge'),
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
    soundToggle: document.getElementById('sound-toggle'),
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
    gameExitBtn: document.getElementById('game-exit-btn'),
    gameGrid: document.getElementById('game-grid'),
    gameTimer: document.getElementById('game-timer'),
    gameRemainingCount: document.getElementById('game-remaining-count'),
    gameRepeatBtn: document.getElementById('game-repeat-btn'),
    btnGameMode: document.getElementById('btn-game-mode')
};

let btnReadAloud = null;
let btnReadAlong = null;

const toastManager = new ToastManager();
const WORD_STATS_KEY = 'readingHelperWordStats';
const SPEED_PREF_KEY = 'readingHelperReadingSpeed';

let currentPronunciations = {};
let currentStoryPath = '';
let currentPhonetics = {};
let localImageUrls = {};
let sessionImages = {};
let currentStoryId = null;
let isCreatorMode = false;
let isPeerConnected = false;

// Preview state for incoming P2P shared stories
let pendingSharedStory = null;
let previousReaderSnapshot = null;

// Long-press syllable state
let pressTimer = null;
let isLongPress = false;
let popupWasShown = false;
let activeWordElement = null;
let touchStartX = 0;
let touchStartY = 0;
const LONG_PRESS_DURATION = 400;

// Karaoke & Story Teller state
let sttManager = null;
const karaokeSession = new KaraokeSession();
let storyWordElements = [];
let storyWordMetadata = [];
let isReadingAlong = false;
let currentReadAlongIndex = 0;
let lastHighlightedReadAlongElement = null;
let readingRate = 1.0;
let isReadAlongPaused = false;
let readAlongSessionId = 0;
let speedUpdateTimeout = null;

let renderTimeout;
const handleStoryInputPreview = () => {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        renderStory();
    }, 300);
};

const peerAdapter = {
    send: (data) => peerService.sendData(data)
};

const gameManager = new GameManager({
    toastManager,
    speakFn: (word) => VoiceManager.speakText(word),
    onCorrect: () => playGameCorrectSound(),
    onWrong: () => playGameWrongSound(),
    onGameOver: (score, time, errors, masteredWords) => {
        GameUI.stopTimer();
        setTimeout(() => {
            GameUI.renderGameGrid();
            VoiceManager.speakText('Amazing job! You finished the game!');
            GameUI.startCelebration(score, time, errors, masteredWords);
        }, 1200);
    }
});

const chatManager = new ChatManager(peerAdapter, () => ({
    name: localStorage.getItem('readinghelper_display_name') || 'Anonymous'
}));
export const uiManager = new UIManager(dom, chatManager, toastManager);

GameUI.init({
    dom,
    gameManager,
    uiManager,
    toastManager,
    getWordStats: loadWordStats
});

/**
 * Unregisters service workers, clears caches, IndexedDB, and localStorage for a full reset.
 */
async function resetApplication() {
    const gateOk = await requireParentGate('Reset App');
    if (!gateOk) return;

    const confirmed = await showConfirmModal({
        title: 'Reset Application?',
        message: 'This will permanently delete all saved stories, cached data, word statistics, and settings.',
        confirmText: 'Reset Everything',
        destructive: true
    });
    if (!confirmed) return;

    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
        }
        await ImageStorage.clearAll();
        localStorage.clear();
        sessionStorage.clear();

        window.location.href = `${window.location.origin}${window.location.pathname}?reset=${Date.now()}`;
    } catch (error) {
        console.error('Error during application reset:', error);
        toastManager.show('An error occurred during reset.', 'error');
    }
}

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
    } catch (error) {
        console.error('Manual update check failed:', error);
        toastManager.show('Failed to check for updates.', 'error');
    }
}

async function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
        const swUrl = new URL('sw.js', window.location.href).href;
        const registration = await navigator.serviceWorker.register(swUrl);

        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    toastManager.show('Update installed! Refreshing...', 'info', 2500);
                }
            });
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });
    } catch (error) {
        console.error('Service Worker registration failed:', error);
    }
}

async function init() {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
    }

    uiManager.initTheme();
    loadWordStats();
    setupServiceWorker();

    sttManager = new SpeechRecognitionManager(
        handleSpeechResult,
        handleSpeechStatusChange,
        (errCode) => {
            if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
                toastManager.show('Microphone access was blocked. Check browser permissions.', 'error');
            } else {
                toastManager.show('Karaoke Mode paused due to a microphone error.', 'error');
            }
        }
    );
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

    document.querySelectorAll('.speed-slider-input').forEach((el) => { el.value = readingRate; });
    document.querySelectorAll('.speed-display-val').forEach((el) => { el.textContent = readingRate.toFixed(1); });

    if (isReadingAlong) {
        isReadAlongPaused = false;
        clearTimeout(speedUpdateTimeout);
        speedUpdateTimeout = setTimeout(() => {
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

function injectReadAloudUI() {
    if (!sttManager.isSupported()) return;

    const headerButtons = document.querySelector('.header-buttons');
    btnReadAloud = document.createElement('button');
    btnReadAloud.type = 'button';
    btnReadAloud.id = 'btn-read-aloud';
    btnReadAloud.className = 'theme-button';
    btnReadAloud.innerHTML = '🎤 <span class="btn-label">Karaoke Mode</span>';
    btnReadAloud.addEventListener('click', toggleReadAloud);
    headerButtons.prepend(btnReadAloud);
}

function injectReadAlongUI() {
    const headerButtons = document.querySelector('.header-buttons');

    const container = document.createElement('div');
    container.className = 'header-speed-control';
    container.innerHTML = `
        <label for="reading-speed-slider"><span class="btn-label">Speed: </span><span class="speed-display-val">${readingRate.toFixed(1)}</span>x</label>
        <input id="reading-speed-slider" type="range" class="speed-slider-input" min="0.8" max="2.0" step="0.1" value="${readingRate}" aria-label="Reading Speed">
    `;

    const slider = container.querySelector('.speed-slider-input');
    slider.addEventListener('input', (e) => updateReadingRate(e.target.value));

    btnReadAlong = document.createElement('button');
    btnReadAlong.type = 'button';
    btnReadAlong.id = 'btn-read-along';
    btnReadAlong.className = 'theme-button';
    btnReadAlong.innerHTML = '🔊 <span class="btn-label">Story Teller</span>';
    btnReadAlong.addEventListener('click', toggleReadAlong);

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
        // Stop Karaoke Mode first so microphone doesn't transcribe computer speech
        if (sttManager && sttManager.isActive) {
            sttManager.stop();
        }
        currentReadAlongIndex = 0;
        startReadAlong();
    }
}

async function startReadAlong() {
    const text = dom.storyInput.value;
    if (!text.trim() || storyWordElements.length === 0) {
        toastManager.show('Choose a story first!', 'info');
        return;
    }

    const mySession = ++readAlongSessionId;
    isReadingAlong = true;
    isReadAlongPaused = false;
    if (btnReadAlong) {
        btnReadAlong.classList.add('speaking');
        btnReadAlong.innerHTML = '🛑 <span class="btn-label">Stop</span>';
    }

    while (isReadingAlong && currentReadAlongIndex < storyWordElements.length && mySession === readAlongSessionId) {
        const range = computeNextSentenceRange(storyWordMetadata, currentReadAlongIndex);
        await runSentenceRead(range, mySession);

        currentReadAlongIndex = range.end + 1;

        if (isReadingAlong && !isReadAlongPaused && mySession === readAlongSessionId) {
            await new Promise((r) => setTimeout(r, 180));
        }
    }

    if (mySession === readAlongSessionId) {
        handleReadAlongEnd();
    }
}

async function runSentenceRead(range, sessionId) {
    const text = dom.storyInput.value;
    const startMeta = storyWordMetadata[range.start];
    const endMeta = storyWordMetadata[range.end];
    if (!startMeta || !endMeta) return;

    const startChar = startMeta.start;
    // Include trailing punctuation right after the final word for natural TTS prosody
    const rawSliceEnd = Math.min(text.length, endMeta.end + 2);
    const sentenceText = text
        .substring(startChar, rawSliceEnd)
        .replace(/\[IMAGE:[^\]]*\]/g, (m) => ' '.repeat(m.length));

    highlightReadAlongWord(range.start);

    await VoiceManager.speakText(sentenceText, null, (event) => {
        if (sessionId !== readAlongSessionId || isReadAlongPaused) return;
        const absoluteCharIndex = (event.charIndex || 0) + startChar;

        for (let i = range.start; i <= range.end; i++) {
            if (absoluteCharIndex >= storyWordMetadata[i].start && absoluteCharIndex < storyWordMetadata[i].end) {
                if (i !== currentReadAlongIndex) {
                    currentReadAlongIndex = i;
                    highlightReadAlongWord(i);
                }
                break;
            }
        }
    }, readingRate);
}

function highlightReadAlongWord(index) {
    const el = storyWordElements[index];
    if (!el || el === lastHighlightedReadAlongElement) return;

    if (lastHighlightedReadAlongElement) {
        lastHighlightedReadAlongElement.classList.remove('read-along-highlight');
    }
    el.classList.add('read-along-highlight');
    lastHighlightedReadAlongElement = el;
    scrollToWord(el);
}

function scrollToWord(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const isVisible = rect.top >= 150 && rect.bottom <= window.innerHeight - 150;
    if (!isVisible) {
        el.scrollIntoView({
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            block: 'center'
        });
    }
}

function toggleReadAlongPause() {
    if (!isReadingAlong) return;

    isReadAlongPaused = !isReadAlongPaused;
    if (isReadAlongPaused) {
        window.speechSynthesis.pause();
        if (btnReadAlong) btnReadAlong.innerHTML = '▶️ <span class="btn-label">Resume</span>';
        toastManager.show('Story Teller paused. Tap the story to resume.', 'info', 1500);
    } else {
        window.speechSynthesis.resume();
        if (btnReadAlong) btnReadAlong.innerHTML = '🛑 <span class="btn-label">Stop</span>';
        toastManager.show('Resuming...', 'info', 1000);
    }
}

function handleReadAlongEnd() {
    if (currentReadAlongIndex >= storyWordElements.length - 1) {
        currentReadAlongIndex = 0;
        if (dom.storyDisplay && dom.storyDisplay.lastElementChild) {
            dom.storyDisplay.lastElementChild.scrollIntoView({
                behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                block: 'end'
            });
        }
    }
    isReadingAlong = false;
    isReadAlongPaused = false;
    if (btnReadAlong) {
        btnReadAlong.classList.remove('speaking');
        btnReadAlong.innerHTML = '🔊 <span class="btn-label">Story Teller</span>';
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
        if (storyWordElements.length === 0) {
            toastManager.show('Choose a story first!', 'info');
            return;
        }
        // Stop Story Teller if currently speaking
        if (isReadingAlong) {
            readAlongSessionId++;
            window.speechSynthesis.cancel();
            handleReadAlongEnd();
        }
        resetReadingPointer();
        sttManager.start();
        toastManager.show('Listening... Read the story out loud!', 'info');
    }
}

function handleSpeechStatusChange(isActive) {
    if (btnReadAloud) {
        btnReadAloud.classList.toggle('speaking', isActive);
        btnReadAloud.innerHTML = isActive
            ? '🛑 <span class="btn-label">Stop Karaoke</span>'
            : '🎤 <span class="btn-label">Karaoke Mode</span>';
    }
    if (!isActive) karaokeSession.onSegmentBoundary();
    updateActiveHighlight();
}

function resetReadingPointer() {
    karaokeSession.reset();
    storyWordElements.forEach((el) => {
        el.classList.remove('read-correct', 'read-skipped', 'read-help', 'read-active', 'read-misspoken');
    });
    updateActiveHighlight();
}

function updateActiveHighlight() {
    storyWordElements.forEach((el) => el.classList.remove('read-active'));
    const pointer = karaokeSession.readingPointer;
    if (sttManager && sttManager.isActive && pointer < storyWordElements.length) {
        const nextWord = storyWordElements[pointer];
        nextWord.classList.add('read-active');
        scrollToWord(nextWord);
    }
}

function markWord(index, status) {
    const el = storyWordElements[index];
    if (!el) return;
    el.classList.remove('read-correct', 'read-skipped', 'read-misspoken', 'read-help');
    if (status === 'correct') el.classList.add('read-correct');
    if (status === 'skipped') el.classList.add('read-skipped');
    if (status === 'misspoken') el.classList.add('read-misspoken');
    if (status === 'help') el.classList.add('read-help');
}

function handleSpeechResult({ final, interim }) {
    if (storyWordElements.length === 0) return;
    const storyWords = storyWordElements.map((el) => el.textContent);

    const outcome = karaokeSession.processResult({
        final,
        interim,
        storyWords,
        customPronunciations: currentPronunciations
    });

    outcome.clearRange.forEach(([from, to]) => {
        for (let j = from; j < to; j++) {
            storyWordElements[j]?.classList.remove('read-correct', 'read-skipped', 'read-misspoken');
        }
    });

    outcome.marks.forEach(({ index, status }) => markWord(index, status));
    outcome.trickyWords.forEach((w) => trackWord(w));
    updateActiveHighlight();

    if (outcome.completed) {
        sttManager.stop();
        setTimeout(() => {
            VoiceManager.speakText('You read the whole story! Well done!');
        }, 500);
    }
}

function speakWordFromStory(rawText, targetElement = activeWordElement) {
    const cleanedWord = cleanWordToken(rawText);
    if (!cleanedWord) return;

    let textToSpeak = cleanedWord;
    if (currentPronunciations[cleanedWord]) {
        textToSpeak = currentPronunciations[cleanedWord];
    }

    if (sttManager && sttManager.isActive && targetElement) {
        const tappedIndex = storyWordElements.indexOf(targetElement);
        if (tappedIndex > -1) {
            markWord(tappedIndex, 'help');
            karaokeSession.recordHelpTap(tappedIndex);
            updateActiveHighlight();
        }
    }

    VoiceManager.speakText(textToSpeak, targetElement, null, readingRate);
}

function trackWord(rawWord) {
    const cleaned = cleanWordToken(rawWord);
    if (!cleaned) return;
    const stats = loadWordStats();
    stats[cleaned] = (stats[cleaned] || 0) + 1;
    localStorage.setItem(WORD_STATS_KEY, JSON.stringify(stats));
    renderDashboard();
}

function loadWordStats() {
    try {
        const statsJSON = localStorage.getItem(WORD_STATS_KEY);
        return statsJSON ? JSON.parse(statsJSON) : {};
    } catch (e) {
        return {};
    }
}

function renderDashboard() {
    if (!dom.trickyWordsList) return;
    const stats = loadWordStats();
    const sortedWords = Object.entries(stats).sort(([, a], [, b]) => b - a);

    if (dom.practiceTrickyBtn) {
        dom.practiceTrickyBtn.disabled = sortedWords.length < 4;
        dom.practiceTrickyBtn.title = sortedWords.length < 4
            ? 'Tap at least 4 tricky words in stories to unlock practice game'
            : 'Play Word Match with your top Tricky Words!';
    }

    if (sortedWords.length === 0) {
        dom.trickyWordsList.innerHTML = '<p class="empty-stats-msg">No tricky words recorded yet. Tap words while reading to track them here!</p>';
        return;
    }

    dom.trickyWordsList.innerHTML = sortedWords.map(([word, count]) => `
        <div class="tricky-word-item">
            <span class="word">${escapeHtml(word)}</span>
            <span class="count">${Number(count) || 0}</span>
        </div>
    `).join('');
}

async function clearAllStats() {
    const confirmed = await showConfirmModal({
        title: 'Clear Word Stats?',
        message: 'Are you sure you want to clear all tracked Tricky Words? This cannot be undone.',
        confirmText: 'Clear Stats',
        destructive: true
    });
    if (confirmed) {
        localStorage.removeItem(WORD_STATS_KEY);
        renderDashboard();
        toastManager.show('Word statistics cleared.', 'info');
    }
}

async function toggleCreatorMode() {
    if (!isCreatorMode) {
        const gateOk = await requireParentGate('Creator Mode');
        if (!gateOk) return;
    }

    isCreatorMode = !isCreatorMode;
    dom.creatorArea.classList.toggle('hidden', !isCreatorMode);

    if (isCreatorMode) {
        dom.creatorModeBtn.querySelector('span').textContent = 'Exit Creator Mode';
        if (!dom.dashboardView.classList.contains('hidden')) {
            uiManager.showView('reader');
        }
        dom.storyInput.addEventListener('input', handleStoryInputPreview);
        renderStory();
        renderPhoneticsEditor(currentPhonetics);
        renderPronunciationEditor(currentPronunciations);
    } else {
        dom.creatorModeBtn.querySelector('span').textContent = 'Enter Creator Mode';
        dom.storyInput.removeEventListener('input', handleStoryInputPreview);
        renderStory();
    }
}

function renderStory() {
    const text = dom.storyInput.value;
    const html = buildStoryHtml(text, {
        aiMetadata: aiManager.getMetadata(),
        sessionImages,
        localImageUrls,
        currentStoryPath,
        isCreatorMode
    });

    dom.storyDisplay.innerHTML = html;
    storyWordElements = Array.from(dom.storyDisplay.querySelectorAll('.speakable-word'));
    storyWordMetadata = storyWordElements.map((el) => ({
        start: parseInt(el.dataset.start, 10),
        end: parseInt(el.dataset.end, 10),
        sentenceEnd: el.dataset.sentenceEnd === 'true'
    }));
    updateActiveHighlight();
}

function setupEventListeners() {
    const listeners = [
        { element: dom.creatorModeBtn, event: 'click', handler: toggleCreatorMode },
        { element: dom.practiceTrickyBtn, event: 'click', handler: () => GameUI.startTrickyWordsGame() },
        { element: dom.clearStatsBtn, event: 'click', handler: clearAllStats },
        { element: dom.resetAppBtn, event: 'click', handler: resetApplication },
        // Preview banner for incoming P2P stories
        { element: dom.previewAcceptBtn, event: 'click', handler: acceptSharedStoryPreview },
        { element: dom.previewDeclineBtn, event: 'click', handler: declineSharedStoryPreview },
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
        // Sidenav / Game
        { element: dom.btnGameMode, event: 'click', handler: () => GameUI.openGameSetSelector() },
        { element: dom.gameExitBtn, event: 'click', handler: () => GameUI.exitGame() },
        { element: dom.gameSetSelectXBtn, event: 'click', handler: () => closeDialog(dom.gameSetSelectModal) },
        {
            element: dom.settingsVoiceSelection,
            event: 'change',
            handler: (e) => {
                const voiceName = e.target.value;
                localStorage.setItem(VoiceManager.VOICE_PREF_KEY, voiceName);
                toastManager.show('Voice saved!', 'success');
                const funPhrases = [
                    'How now brown cow!',
                    'Peter Piper picked a peck of pickled peppers.',
                    'She sells seashells by the seashore.',
                    'I am ready to help you read today!',
                    'A big blue bear baked a batch of bread.',
                    'Six slippery snails slid slowly seaward.'
                ];
                const randomPhrase = funPhrases[Math.floor(Math.random() * funPhrases.length)];
                VoiceManager.speakText(randomPhrase);
            }
        },
        { element: dom.gameSetSelectList, event: 'click', handler: (e) => GameUI.handleGameSetSelection(e) },
        { element: dom.confirmGameStartBtn, event: 'click', handler: () => GameUI.startSelectedGame() },
        { element: dom.addGameSetBtn, event: 'click', handler: () => GameUI.addNewGameSet() },
        { element: dom.gameSetEditorList, event: 'click', handler: (e) => GameUI.handleGameSetEditorAction(e) },
        { element: dom.gameSetEditorList, event: 'change', handler: (e) => GameUI.saveGameSetFromUI(e) },
        { element: dom.testApiKeyBtn, event: 'click', handler: testGeminiConnection },
        { element: dom.checkUpdatesBtn, event: 'click', handler: checkForUpdates },
        { element: dom.gameRepeatBtn, event: 'click', handler: () => VoiceManager.speakText(gameManager.state.targetWord) },
        {
            element: dom.celebDoneBtn,
            event: 'click',
            handler: () => {
                GameUI.stopCelebration();
                uiManager.showView('reader');
            }
        },
        {
            element: dom.celebPlayAgainBtn,
            event: 'click',
            handler: () => {
                GameUI.stopCelebration();
                GameUI.startSelectedGame();
            }
        }
    ];

    listeners.forEach(({ element, event, handler }) => {
        if (element) element.addEventListener(event, handler);
    });

    // Pointer press & hold for syllable pop-up + tap-to-speak
    dom.storyDisplay.addEventListener('pointerdown', handlePressStart);
    dom.storyDisplay.addEventListener('pointermove', handlePointerMove);
    dom.storyDisplay.addEventListener('pointercancel', handlePressEnd);
    dom.storyDisplay.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.speakable-word')) e.preventDefault();
    });

    // Keyboard accessibility for speakable words (Enter/Space to speak, Shift+Enter for syllables)
    dom.storyDisplay.addEventListener('keydown', (e) => {
        const wordEl = e.target.closest('.speakable-word');
        if (!wordEl) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.shiftKey) {
                showSyllablePopup(wordEl.textContent, wordEl);
                setTimeout(hideSyllablePopup, 1800);
            } else if (isReadingAlong) {
                toggleReadAlongPause();
            } else {
                const rawWord = wordEl.textContent;
                speakWordFromStory(rawWord, wordEl);
                trackWord(rawWord);
            }
        }
    });

    dom.gameGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.flash-card');
        if (!card || card.classList.contains('flipped')) return;

        const word = card.dataset.word;
        const index = parseInt(card.dataset.index, 10);

        if (gameManager.handleChoice(word, index)) {
            GameUI.triggerCorrectEffect(card);
            card.classList.add('flipped');
            setTimeout(() => {
                GameUI.renderGameGrid();
                if (gameManager.state.active && gameManager.state.targetWord) {
                    VoiceManager.speakText(gameManager.state.targetWord);
                }
            }, 1600);
        }
    });

    dom.storyDisplay.addEventListener('click', (e) => {
        if (e.target.classList.contains('retry-image-btn')) {
            aiManager.retryGeneration(e.target.dataset.filename, sessionImages, localImageUrls);
            return;
        }
        if (isReadingAlong && !e.target.closest('.speakable-word')) {
            toggleReadAlongPause();
        }
    });

    window.addEventListener('pointerup', handlePressEnd);
}

async function performStorageMaintenance() {
    try {
        const deletedCount = await storyManager.cleanupOrphanedImages();
        if (deletedCount > 0) {
            console.log(`Storage maintenance complete. Cleaned up ${deletedCount} orphaned images.`);
        }
    } catch (error) {
        console.error('Storage maintenance failed:', error);
    }
}

function updateConnectButtonState(connected, peerCount = 0) {
    isPeerConnected = connected;
    chatManager.enable(connected);
    if (dom.connectBtn) {
        const labelEl = dom.connectBtn.querySelector('.connect-label');
        if (labelEl) labelEl.textContent = connected ? 'Disconnect' : 'Connect';
        dom.connectBtn.classList.toggle('connected', connected);
    }
    if (dom.peerCountBadge) {
        dom.peerCountBadge.textContent = String(peerCount || (connected ? 1 : 0));
        dom.peerCountBadge.classList.toggle('hidden', !connected);
    }
}

async function handleConnectClick() {
    uiManager.closeNav();
    if (isPeerConnected) {
        const confirmed = await showConfirmModal({
            title: 'Disconnect from Peer?',
            message: 'Are you sure you want to close the peer connection?',
            confirmText: 'Disconnect',
            destructive: true
        });
        if (confirmed) {
            peerService.destroyPeer();
            updateConnectButtonState(false, 0);
            loadStoryLibrary();
        }
    } else {
        showPeerConnectionModal(toastManager, {
            appPrefix: 'readinghelper',
            peerPrefix: 'readinghelper-',
            onDataReceived: (data, peerName) => {
                if (!data || typeof data !== 'object') return;
                if (data.type === 'story-transfer') {
                    handleStoryTransfer(data, peerName);
                } else if (data.type === 'chat') {
                    chatManager.handleIncomingMessage(String(data.content || ''), peerName || 'Peer');
                }
            },
            onConnectionChange: (connected, count) => {
                updateConnectButtonState(connected, count);
                loadStoryLibrary();
            }
        });
    }
}

async function loadStoryLibrary() {
    await loadDefaultStories();
    await loadMyStories();
}

async function loadDefaultStories() {
    if (dom.storyList.querySelector('#default-stories-group')) return;

    try {
        const response = await fetch('stories.json');
        const stories = await response.json();

        const storiesHtml = stories.map((story) => `
            <div class="story-item" role="button" tabindex="0" data-path="${escapeHtml(story.path)}">
                <span class="story-item-title">${escapeHtml(story.title)}</span>
                ${GameUI.getLevelBadgeHtml(story.level)}
            </div>`
        ).join('');

        const groupHtml = `
            <div id="default-stories-group" class="story-group">
                <button type="button" class="story-group-header">Read-Along Stories</button>
                <div class="story-group-content">${storiesHtml}</div>
            </div>
        `;
        dom.storyList.insertAdjacentHTML('beforeend', groupHtml);
    } catch (e) {
        console.error('Could not load default stories', e);
    }
}

async function loadMyStories() {
    const localStories = storyManager.getUserStories();
    if (localStories.length > 0) {
        addLocalStoriesToModal(localStories);
    } else {
        const group = dom.storyList.querySelector('#local-stories-group');
        if (group) group.remove();
    }
}

function addLocalStoriesToModal(stories) {
    let group = dom.storyList.querySelector('#local-stories-group');
    if (!group) {
        dom.storyList.insertAdjacentHTML('afterbegin', `
            <div id="local-stories-group" class="story-group">
                <button type="button" class="story-group-header">My Stories</button>
                <div class="story-group-content"></div>
            </div>
        `);
        group = dom.storyList.querySelector('#local-stories-group');
    }

    const contentArea = group.querySelector('.story-group-content');
    contentArea.innerHTML = stories.map((story) => {
        const safeId = escapeHtml(story.id);
        const safeTitle = escapeHtml(story.title);
        return `
            <div class="story-item" role="button" tabindex="0" data-local-story-id="${safeId}" data-title="${safeTitle}">
                <span class="story-item-title">${safeTitle}</span>
                <button type="button" class="theme-button story-share-btn" data-local-story-id="${safeId}" title="${isPeerConnected ? 'Share story' : 'Connect to a peer to share'}" ${isPeerConnected ? '' : 'disabled'}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    <span>Share</span>
                </button>
                <button type="button" class="theme-button story-delete-btn destructive" data-local-story-id="${safeId}" title="Delete story">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    <span>Delete</span>
                </button>
            </div>`;
    }).join('');
}

async function testGeminiConnection() {
    const apiKey = dom.googleApiKeyInput.value.trim() || localStorage.getItem('google_ai_api_key');
    await aiManager.testGeminiConnection(apiKey, dom.apiKeyStatus);
}

async function illustrateStoryWithGemini() {
    await aiManager.illustrateStory(dom.storyInput.value.trim(), (text) => {
        dom.storyInput.value = text;
        renderStory();
    }, sessionImages, localImageUrls);
}

async function insertMagicImageAtCursor() {
    const start = dom.storyInput.selectionStart;
    const end = dom.storyInput.selectionEnd;
    const selectedText = dom.storyInput.value.substring(start, end).trim();
    if (!selectedText) {
        toastManager.show('Highlight a sentence or paragraph in the story box first!', 'info');
        return;
    }

    const hiddenDetails = await showPromptModal({
        title: '🖼️ Magic Image Details',
        message: 'Optional art style or character details (leave blank for default):',
        placeholder: 'e.g., Studio Ghibli watercolor, red ribbon',
        confirmText: 'Create Image',
        allowEmpty: true
    });
    if (hiddenDetails === null) return;

    await aiManager.insertMagicImage(dom.storyInput.value, start, end, hiddenDetails, (text) => {
        dom.storyInput.value = text;
        renderStory();
    }, sessionImages, localImageUrls);
}

async function handleStoryListClick(event) {
    const target = event.target;

    if (target.classList.contains('story-group-header')) {
        const isCollapsed = target.classList.contains('collapsed');
        dom.storyList.querySelectorAll('.story-group-header').forEach((header) => {
            header.classList.add('collapsed');
            header.nextElementSibling?.classList.add('hidden');
        });
        target.classList.toggle('collapsed', !isCollapsed);
        target.nextElementSibling?.classList.toggle('hidden', !isCollapsed);
    } else if (target.closest('.story-delete-btn')) {
        const btn = target.closest('.story-delete-btn');
        const storyTitle = btn.closest('.story-item')?.querySelector('.story-item-title')?.textContent || 'Story';
        if (btn.dataset.localStoryId) {
            await deleteMyStory(btn.dataset.localStoryId, storyTitle);
        }
    } else if (target.closest('.story-share-btn')) {
        const btn = target.closest('.story-share-btn');
        const storyId = btn.dataset.localStoryId;
        const storyTitle = btn.closest('.story-item')?.querySelector('.story-item-title')?.textContent || 'Story';
        await shareStory(storyId, storyTitle);
    } else if (target.closest('[data-local-story-id]')) {
        const storyId = target.closest('[data-local-story-id]').dataset.localStoryId;
        await loadUserStory(storyId);
    } else if (target.closest('[data-path]')) {
        const storyItem = target.closest('.story-item');
        await loadBuiltInOrRemoteStory(storyItem.dataset.path);
    }
}

async function loadBuiltInOrRemoteStory(path) {
    clearSharedStoryPreviewBanner();
    currentStoryPath = path;
    localImageUrls = {};
    sessionImages = {};
    currentStoryId = null;
    currentPhonetics = {};
    currentPronunciations = {};
    aiManager.clearMetadata();

    try {
        const fetchJsonSafe = (url) => fetch(url)
            .then((res) => (res.ok ? res.json() : {}))
            .catch(() => ({}));

        const [storyResponse, phoneticsData, pronunciationsData] = await Promise.all([
            fetch(`${path}story.txt`),
            fetchJsonSafe(`${path}phonetics.json`),
            fetchJsonSafe(`${path}pronunciations.json`)
        ]);

        if (!storyResponse.ok) throw new Error('Story file not found');
        const storyText = await storyResponse.text();

        currentPhonetics = phoneticsData || {};
        currentPronunciations = pronunciationsData || {};
        dom.storyInput.value = storyText;

        const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
        const matches = [...storyText.matchAll(imageRegex)];
        for (const match of matches) {
            const imageIdentifier = match[1].trim();
            const isFilePath = !imageIdentifier.startsWith('ai-gen-') && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(imageIdentifier);
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

        renderPhoneticsEditor(currentPhonetics);
        renderPronunciationEditor(currentPronunciations);

        uiManager.closeStoryModal();
        renderStory();
    } catch (error) {
        console.error(`Failed to load story module from ${path}`, error);
        toastManager.show('Could not load the selected story.', 'error');
    }
}

async function handleLoadFromUrl() {
    let baseUrl = await showPromptModal({
        title: '🌐 Load Stories from Web',
        message: 'Enter the URL to a ReadingHelper story library folder:',
        defaultValue: 'https://rahbster.github.io/ReadingHelper/',
        confirmText: 'Load Library'
    });
    if (!baseUrl) return;

    if (!baseUrl.endsWith('/')) baseUrl += '/';

    try {
        const parsedBase = new URL(baseUrl);
        if (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') {
            throw new Error('Only HTTP/HTTPS URLs are supported.');
        }

        const libraryUrl = new URL('stories.json', parsedBase).href;

        dom.storyList.querySelectorAll('.story-group-header').forEach((header) => {
            header.classList.add('collapsed');
            header.nextElementSibling?.classList.add('hidden');
        });

        const response = await fetch(libraryUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status} when fetching stories.json`);

        const stories = await response.json();
        if (!Array.isArray(stories)) throw new Error('Invalid story library manifest.');

        const newStoriesHtml = stories.map((story) => {
            const fullStoryPath = new URL(story.path, parsedBase).href;
            return `
                <div class="story-item" role="button" tabindex="0" data-path="${escapeHtml(fullStoryPath)}">
                    <span class="story-item-title">${escapeHtml(story.title)}</span>
                    ${GameUI.getLevelBadgeHtml(story.level)}
                </div>`;
        }).join('');

        const groupHostname = parsedBase.hostname;
        const SafeSelectorHost = CSS.escape ? CSS.escape(groupHostname) : groupHostname.replace(/"/g, '');
        const existingGroup = dom.storyList.querySelector(`.story-group[data-source="${SafeSelectorHost}"]`);
        if (existingGroup) existingGroup.remove();

        const newGroupHtml = `
            <div class="story-group" data-source="${escapeHtml(groupHostname)}">
                <button type="button" class="story-group-header">${escapeHtml(groupHostname)}</button>
                <div class="story-group-content">${newStoriesHtml}</div>
            </div>
        `;
        dom.storyList.insertAdjacentHTML('beforeend', newGroupHtml);
        toastManager.show(`Loaded ${stories.length} stories from ${groupHostname}!`, 'success');
    } catch (error) {
        console.error('Error loading story from URL:', error);
        toastManager.show(`Could not load library: ${error.message}`, 'error');
    }
}

function clearSharedStoryPreviewBanner() {
    pendingSharedStory = null;
    previousReaderSnapshot = null;
    dom.previewBanner?.classList.add('hidden');
}

/**
 * Displays incoming P2P stories in preview mode using `#preview-banner` before saving to storage.
 */
async function handleStoryTransfer(storyPackage, peerName = 'Peer') {
    if (!storyPackage || storyPackage.type !== 'story-transfer' || !storyPackage.files) return;

    const storyTitle = String(storyPackage.title || 'Shared Story').slice(0, 100);

    try {
        const story = {
            title: storyTitle,
            content: String(storyPackage.files['story.txt'] || ''),
            phonetics: {},
            pronunciations: {},
            images: {}
        };

        if (storyPackage.files['phonetics.json']) {
            try { story.phonetics = JSON.parse(storyPackage.files['phonetics.json']) || {}; } catch (e) {}
        }
        if (storyPackage.files['pronunciations.json']) {
            try { story.pronunciations = JSON.parse(storyPackage.files['pronunciations.json']) || {}; } catch (e) {}
        }

        for (const [path, data] of Object.entries(storyPackage.files)) {
            if (path.startsWith('images/') && typeof data === 'string' && data.startsWith('data:image/')) {
                const imageName = path.split('/').pop();
                story.images[imageName] = data;
            }
        }

        // Save snapshot of current story so Declining restores the reader cleanly
        if (!previousReaderSnapshot) {
            previousReaderSnapshot = {
                text: dom.storyInput.value,
                storyId: currentStoryId,
                storyPath: currentStoryPath,
                phonetics: { ...currentPhonetics },
                pronunciations: { ...currentPronunciations },
                sessionImages: { ...sessionImages },
                localImageUrls: { ...localImageUrls },
                aiMetadata: { ...aiManager.getMetadata() }
            };
        }

        pendingSharedStory = story;
        currentStoryId = null;
        currentStoryPath = '';
        dom.storyInput.value = story.content;
        currentPhonetics = story.phonetics;
        currentPronunciations = story.pronunciations;
        sessionImages = { ...story.images };
        localImageUrls = { ...story.images };
        aiManager.clearMetadata();

        renderPhoneticsEditor(currentPhonetics);
        renderPronunciationEditor(currentPronunciations);

        uiManager.showView('reader');
        if (dom.previewBannerText) {
            dom.previewBannerText.textContent = `${peerName} shared "${storyTitle}". Would you like to keep it?`;
        }
        dom.previewBanner?.classList.remove('hidden');
        renderStory();
        toastManager.show(`Previewing "${storyTitle}" from ${peerName}`, 'info', 4000);
    } catch (error) {
        console.error('Error previewing received story:', error);
        toastManager.show('Failed to read incoming story.', 'error');
    }
}

async function acceptSharedStoryPreview() {
    if (!pendingSharedStory) return;
    try {
        const saved = await storyManager.saveUserStory(pendingSharedStory);
        currentStoryId = saved?.id || null;
        const title = pendingSharedStory.title;
        clearSharedStoryPreviewBanner();
        await loadStoryLibrary();
        toastManager.show(`Saved "${title}" to My Stories!`, 'success');
    } catch (e) {
        console.error('Error saving accepted story:', e);
        toastManager.show('Could not save shared story.', 'error');
    }
}

function declineSharedStoryPreview() {
    if (previousReaderSnapshot) {
        dom.storyInput.value = previousReaderSnapshot.text;
        currentStoryId = previousReaderSnapshot.storyId;
        currentStoryPath = previousReaderSnapshot.storyPath;
        currentPhonetics = previousReaderSnapshot.phonetics;
        currentPronunciations = previousReaderSnapshot.pronunciations;
        sessionImages = previousReaderSnapshot.sessionImages;
        localImageUrls = previousReaderSnapshot.localImageUrls;
        aiManager.setMetadata(previousReaderSnapshot.aiMetadata);
        renderPhoneticsEditor(currentPhonetics);
        renderPronunciationEditor(currentPronunciations);
        renderStory();
    }
    clearSharedStoryPreviewBanner();
    toastManager.show('Declined shared story.', 'info', 2000);
}

async function shareStory(storyId, storyTitle) {
    const story = await storyManager.getUserStoryById(storyId);
    if (!story) {
        toastManager.show('Could not find the story to share.', 'error');
        return;
    }

    try {
        const storyPackage = {
            type: 'story-transfer',
            title: storyTitle,
            files: {
                'story.txt': story.content
            }
        };

        if (story.phonetics) storyPackage.files['phonetics.json'] = JSON.stringify(story.phonetics);
        if (story.pronunciations) storyPackage.files['pronunciations.json'] = JSON.stringify(story.pronunciations);

        if (story.images) {
            for (const [name, base64] of Object.entries(story.images)) {
                storyPackage.files[`images/${name}`] = base64;
            }
        }

        const sent = peerService.sendData(storyPackage);
        if (sent) {
            toastManager.show(`Story "${storyTitle}" has been sent!`, 'success');
        } else {
            toastManager.show('No active peer connection to send story.', 'error');
        }
    } catch (error) {
        console.error('Error packaging or sending story:', error);
        toastManager.show('Could not share the story.', 'error');
    }
}

async function loadUserStory(id) {
    const story = await storyManager.getUserStoryById(id);
    if (!story) return;

    clearSharedStoryPreviewBanner();
    currentStoryId = story.id;
    currentStoryPath = '';
    dom.storyInput.value = story.content;

    renderPhoneticsEditor(story.phonetics || {});
    renderPronunciationEditor(story.pronunciations || {});

    localImageUrls = {};
    sessionImages = {};
    aiManager.clearMetadata();

    if (story.images) {
        for (const [name, base64] of Object.entries(story.images)) {
            sessionImages[name] = base64;
            localImageUrls[name] = base64;
        }
    }
    if (story.aiImageMetadata) {
        aiManager.setMetadata(story.aiImageMetadata);
        aiManager.resumeQueue(sessionImages, localImageUrls);
    }

    uiManager.closeStoryModal();
    renderStory();
}

function showSyllablePopup(word, targetElement) {
    popupWasShown = false;
    const popup = dom.syllablePopup;
    const cleaned = cleanWordToken(word);
    const syllabifiedWord = VoiceManager.getSyllables(cleaned, currentPhonetics);

    if (!syllabifiedWord || syllabifiedWord === cleaned) {
        return;
    }

    popup.textContent = syllabifiedWord;
    popup.classList.remove('hidden');

    const rect = targetElement.getBoundingClientRect();
    popup.style.top = `${rect.top + window.scrollY - popup.offsetHeight - 10}px`;
    let left = rect.left + window.scrollX + (rect.width / 2) - (popup.offsetWidth / 2);
    left = Math.max(10, Math.min(left, window.innerWidth - popup.offsetWidth - 10));
    popup.style.left = `${left}px`;

    requestAnimationFrame(() => popup.classList.add('show'));
    popupWasShown = true;
}

function hideSyllablePopup() {
    const popup = dom.syllablePopup;
    popup.classList.remove('show');
    popup.addEventListener('transitionend', () => popup.classList.add('hidden'), { once: true });
}

function handlePressStart(event) {
    activeWordElement = event.target.closest('.speakable-word');
    if (!activeWordElement) return;

    touchStartX = event.clientX;
    touchStartY = event.clientY;
    isLongPress = false;
    popupWasShown = false;

    pressTimer = setTimeout(() => {
        isLongPress = true;
        if (activeWordElement) {
            showSyllablePopup(activeWordElement.textContent, activeWordElement);
        }
    }, LONG_PRESS_DURATION);
}

function handlePointerMove(event) {
    if (!pressTimer || !activeWordElement) return;
    const deltaX = Math.abs(event.clientX - touchStartX);
    const deltaY = Math.abs(event.clientY - touchStartY);
    if (deltaX > 10 || deltaY > 10) {
        clearTimeout(pressTimer);
        pressTimer = null;
        activeWordElement = null;
    }
}

function handlePressEnd() {
    const wasShortPress = pressTimer !== null;
    clearTimeout(pressTimer);
    pressTimer = null;

    if (isLongPress && popupWasShown) {
        setTimeout(hideSyllablePopup, 300);
    } else if (wasShortPress && activeWordElement) {
        if (isReadingAlong) {
            toggleReadAlongPause();
        } else {
            const rawWord = activeWordElement.textContent;
            speakWordFromStory(rawWord, activeWordElement);
            trackWord(rawWord);
        }
    }

    activeWordElement = null;
    isLongPress = false;
}

function renderPhoneticsEditor(phonetics = {}) {
    currentPhonetics = phonetics;
    dom.phoneticsEditor.innerHTML = Object.entries(phonetics).map(([word, replacement]) => `
        <div class="phonetic-pair">
            <input type="text" class="original-word" value="${escapeHtml(word)}" placeholder="Original word" aria-label="Original word">
            <span class="arrow">→</span>
            <input type="text" class="replacement-word" value="${escapeHtml(replacement)}" placeholder="syl-la-bles" aria-label="Syllables">
            <div class="pair-controls">
                <button type="button" class="remove-btn" title="Remove this pair" aria-label="Remove pair">❌</button>
            </div>
        </div>
    `).join('');
}

function addPhoneticPair() {
    dom.phoneticsEditor.insertAdjacentHTML('beforeend', `
        <div class="phonetic-pair">
            <input type="text" class="original-word" placeholder="Original word" aria-label="Original word">
            <span class="arrow">→</span>
            <input type="text" class="replacement-word" placeholder="syl-la-bles" aria-label="Syllables">
            <div class="pair-controls">
                <button type="button" class="remove-btn" title="Remove this pair" aria-label="Remove pair">❌</button>
            </div>
        </div>
    `);
}

function handlePhoneticsEditorClick(event) {
    const target = event.target;
    const pairElement = target.closest('.phonetic-pair');
    if (pairElement && target.classList.contains('remove-btn')) {
        pairElement.remove();
    }
}

function renderPronunciationEditor(pronunciations = {}) {
    currentPronunciations = pronunciations;
    dom.pronunciationsEditor.innerHTML = Object.entries(pronunciations).map(([word, replacement]) => `
        <div class="pronunciation-pair">
            <input type="text" class="original-word" value="${escapeHtml(word)}" placeholder="Original word" aria-label="Original word">
            <span class="arrow">→</span>
            <input type="text" class="replacement-word" value="${escapeHtml(replacement)}" placeholder="How to say it" aria-label="Pronunciation">
            <div class="pair-controls">
                <button type="button" class="speak-btn" title="Speak this pronunciation" aria-label="Test pronunciation">🔊</button>
                <button type="button" class="remove-btn" title="Remove this pair" aria-label="Remove pair">❌</button>
            </div>
        </div>
    `).join('');
}

function addPronunciationPair() {
    dom.pronunciationsEditor.insertAdjacentHTML('beforeend', `
        <div class="pronunciation-pair">
            <input type="text" class="original-word" placeholder="Original word" aria-label="Original word">
            <span class="arrow">→</span>
            <input type="text" class="replacement-word" placeholder="How to say it" aria-label="Pronunciation">
            <div class="pair-controls">
                <button type="button" class="speak-btn" title="Speak this pronunciation" aria-label="Test pronunciation">🔊</button>
                <button type="button" class="remove-btn" title="Remove this pair" aria-label="Remove pair">❌</button>
            </div>
        </div>
    `);
}

function handlePronunciationEditorClick(event) {
    const target = event.target;
    const pairElement = target.closest('.pronunciation-pair');
    if (!pairElement) return;

    if (target.classList.contains('speak-btn')) {
        const replacementInput = pairElement.querySelector('.replacement-word');
        const textToSpeak = replacementInput?.value.trim();
        if (textToSpeak) VoiceManager.speakText(textToSpeak);
    } else if (target.classList.contains('remove-btn')) {
        pairElement.remove();
    }
}

function addImageToStory() {
    const input = document.getElementById('image-upload-input') || document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.value = '';
    input.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result;
            const safeFileName = file.name.replace(/[\[\]]/g, '_');
            sessionImages[safeFileName] = base64;
            localImageUrls[safeFileName] = base64;

            const imageTag = `[IMAGE: ${safeFileName}]`;
            const { selectionStart, selectionEnd, value } = dom.storyInput;
            dom.storyInput.value = value.slice(0, selectionStart) + imageTag + value.slice(selectionEnd);
            renderStory();
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

async function saveUserStory() {
    const storyText = dom.storyInput.value.trim();
    if (!storyText) {
        toastManager.show('Please write a story before saving.', 'error');
        return;
    }

    const phoneticsObj = {};
    dom.phoneticsEditor.querySelectorAll('.phonetic-pair').forEach((pair) => {
        const original = cleanWordToken(pair.querySelector('.original-word')?.value || '');
        const replacement = (pair.querySelector('.replacement-word')?.value || '').trim();
        if (original && replacement) phoneticsObj[original] = replacement;
    });

    const pronunciationsObj = {};
    dom.pronunciationsEditor.querySelectorAll('.pronunciation-pair').forEach((pair) => {
        const original = cleanWordToken(pair.querySelector('.original-word')?.value || '');
        const replacement = (pair.querySelector('.replacement-word')?.value || '').trim();
        if (original && replacement) pronunciationsObj[original] = replacement;
    });

    try {
        const existingStory = currentStoryId ? await storyManager.getUserStoryById(currentStoryId) : null;
        const title = await showPromptModal({
            title: '💾 Save Story',
            message: 'Enter a title for your story:',
            defaultValue: existingStory?.title || '',
            placeholder: 'My Magical Adventure',
            confirmText: 'Save Story'
        });
        if (!title) return;

        const story = {
            title,
            content: storyText,
            phonetics: phoneticsObj,
            pronunciations: pronunciationsObj,
            images: {}
        };

        if (currentStoryId) {
            story.id = currentStoryId;
            if (existingStory && existingStory.images) {
                story.images = { ...existingStory.images };
            }
        }

        for (const imageName of Object.keys(sessionImages)) {
            story.images[imageName] = sessionImages[imageName];
        }

        const aiMetadata = aiManager.getMetadata();
        if (Object.keys(aiMetadata).length > 0) {
            story.aiImageMetadata = aiMetadata;
        }

        const savedStory = await storyManager.saveUserStory(story);
        if (savedStory?.id) currentStoryId = savedStory.id;

        currentPhonetics = phoneticsObj;
        currentPronunciations = pronunciationsObj;
        toastManager.show(`Story "${title}" saved!`, 'success');
        await loadStoryLibrary();
    } catch (error) {
        console.error('Error saving story:', error);
        toastManager.show('Could not save the story.', 'error');
    }
}

async function deleteMyStory(storyId, storyTitle) {
    const gateOk = await requireParentGate('Delete Story');
    if (!gateOk) return;

    const confirmed = await showConfirmModal({
        title: 'Delete Story?',
        message: `Are you sure you want to permanently delete "${storyTitle}"?`,
        confirmText: 'Delete Story',
        destructive: true
    });
    if (!confirmed) return;

    await storyManager.deleteUserStory(storyId);
    if (currentStoryId === storyId) {
        currentStoryId = null;
    }
    toastManager.show(`Deleted "${storyTitle}".`, 'info');
    await loadStoryLibrary();
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.getVoices();
            VoiceManager.populateVoiceList(dom.settingsVoiceSelection);
        };
    }
}

init();
