import * as peerService from './peer-service.js';
import * as storyManager from '../story-manager.js';
import { ToastManager } from './ToastManager.js';
import { ChatManager } from './ChatManager.js';
import { showPeerConnectionModal } from './modals/peer_connection_modal.js';

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
    // Chat
    btnOpenChat: document.getElementById('btn-open-chat'),
    chatModal: document.getElementById('chat-modal'),
    closeChatModalBtn: document.getElementById('close-chat-modal'),
};

const toastManager = new ToastManager();
const WORD_STATS_KEY = 'readingHelperWordStats';
let currentPronunciations = {}; // Holds the pronunciation guide for the currently loaded story
let currentStoryPath = '';      // Holds the base path for the current story module
let currentPhonetics = {};      // Holds the phonetic guide for the currently loaded story
let localImageUrls = {};        // Holds ObjectURLs for locally loaded images
let pressTimer = null;
let isLongPress = false;
let popupWasShown = false; // Add a new flag to track if the popup was actually displayed
let activeWordElement = null; // Keep track of the element being pressed
const LONG_PRESS_DURATION = 400; // 400ms for a long press
let isCreatorMode = false;
let currentlySpeakingElement = null; // Tracks the element currently being spoken
let currentStoryId = null; // Holds the ID of the currently loaded user story
let sessionImages = {}; // Holds Base64 images for the current session
let isPeerConnected = false;

// Adapter to allow ChatManager to use peerService
const peerAdapter = {
    send: (data) => peerService.sendData(data)
};

const chatManager = new ChatManager(peerAdapter, () => ({ name: localStorage.getItem('readinghelper_display_name') || 'Anonymous' }));

/**
 * Unregisters service workers, clears caches, and all local storage to perform a full reset.
 */
async function resetApplication() {
    if (!confirm('Are you sure you want to perform a full reset? This will clear all cached data and word statistics.')) {
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
        console.log('Reset complete. Reloading page.');
        window.location.reload();
    } catch (error) {
        console.error('Error during application reset:', error);
        alert('An error occurred during the reset process. Please check the console for details.');
    }
}

/**
 * Main initialization function.
 */
async function init() {
    initTheme();
    loadWordStats();
    await loadStoryLibrary();
    setupEventListeners();
    renderDashboard();
}

/**
 * Sets up all the event listeners for the application.
 */
function setupEventListeners() {
    const listeners = [
        // Main Controls
        { element: dom.chooseStoryBtn, event: 'click', handler: openStoryModal },
        { element: dom.toggleDashboardBtn, event: 'click', handler: () => { toggleDashboard(); closeNav(); } },
        { element: dom.creatorModeBtn, event: 'click', handler: toggleCreatorMode },

        // Dashboard
        { element: dom.clearStatsBtn, event: 'click', handler: clearAllStats },
        { element: dom.resetAppBtn, event: 'click', handler: resetApplication },

        // Story Modal
        { element: dom.storyModalXBtn, event: 'click', handler: closeStoryModal },
        { element: dom.storyModal, event: 'click', handler: (e) => { if (e.target === dom.storyModal) closeStoryModal(); } },
        { element: dom.loadFromUrlBtn, event: 'click', handler: handleLoadFromUrl },
        { element: dom.connectBtn, event: 'click', handler: handleConnectClick },
        { element: dom.refreshStoryListBtn, event: 'click', handler: loadStoryLibrary },
        { element: dom.storyList, event: 'click', handler: handleStoryListClick },

        // Creator Mode
        { element: dom.addImageBtn, event: 'click', handler: addImageToStory },
        { element: dom.addPhoneticBtn, event: 'click', handler: () => addPhoneticPair() },
        { element: dom.phoneticsEditor, event: 'click', handler: handlePhoneticsEditorClick },
        { element: dom.addPronunciationBtn, event: 'click', handler: () => addPronunciationPair() },
        { element: dom.pronunciationsEditor, event: 'click', handler: handlePronunciationEditorClick },
        { element: dom.saveStoryBtn, event: 'click', handler: saveUserStory },

        // Sidenav
        { element: dom.hamburgerBtn, event: 'click', handler: openNav },
        { element: dom.closeSidenavBtn, event: 'click', handler: closeNav },
        { element: dom.overlay, event: 'click', handler: closeNav },
        { element: dom.themeToggle, event: 'click', handler: toggleTheme },
        { element: dom.settingsNameInput, event: 'change', handler: updateDisplayName },

        // Chat
        { element: dom.btnOpenChat, event: 'click', handler: openChatModal },
        { element: dom.closeChatModalBtn, event: 'click', handler: closeChatModal },
    ];

    listeners.forEach(({ element, event, handler }) => {
        if (element) {
            element.addEventListener(event, handler);
        }
    });

    // Press and hold logic for syllable pop-up
    dom.storyDisplay.addEventListener('mousedown', handlePressStart);
    dom.storyDisplay.addEventListener('touchstart', handlePressStart, { passive: false });

    // Add listeners to the window to catch the end of a press anywhere
    window.addEventListener('mouseup', handlePressEnd);
    window.addEventListener('touchend', handlePressEnd);
}

function openNav() {
    dom.sidenav.style.width = "280px";
    dom.overlay.style.display = "block";
    // Populate settings name when opening nav
    const name = localStorage.getItem('readinghelper_display_name') || '';
    if (dom.settingsNameInput) {
        dom.settingsNameInput.value = name;
    }
}

function closeNav() {
    dom.sidenav.style.width = "0";
    dom.overlay.style.display = "none";
}

function toggleTheme() {
    const currentTheme = document.body.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    dom.themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌓';
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.body.setAttribute('data-theme', savedTheme);
        if (dom.themeToggle) dom.themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌓';
    }
}

function openChatModal() {
    closeNav();
    dom.chatModal.classList.remove('hidden');
    chatManager.resetUnread();
}

function closeChatModal() {
    dom.chatModal.classList.add('hidden');
}

/**
 * Handles the main connect button click.
 */
function handleConnectClick() {
    closeNav();
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
 * Renders the text from the input area into the story display area,
 * making each word interactive.
 */
function renderStory() {
    const text = dom.storyInput.value; // We still use storyInput as the source of truth
    // Split by spaces and punctuation, but keep them for rendering.
    // This regex splits on spaces, newlines, and common punctuation.
    const parts = text.split(/(\[IMAGE:.*?\]|[ \n.,!?;:"()])/);

    const html = parts.map(part => {
        if (!part) return '';

        // Check for our custom image tag
        const imageMatch = part.match(/^\[IMAGE:(.*?)\]$/);
        if (imageMatch) {
            const imagePath = imageMatch[1].trim();
            const imageName = imagePath.split('/').pop(); // e.g., 'house.png'
            
            // Use a local object URL if available, otherwise construct path from web.
            const fullImagePath = localImageUrls[imageName] 
                ? localImageUrls[imageName]
                : `${currentStoryPath}${imagePath}`;

            return `<img src="${fullImagePath}" alt="Story illustration" class="story-image">`;
        }

        // Check if the part is a word (contains letters)
        if (/[a-zA-Z']/.test(part) && /[a-zA-Z]/.test(part)) { // Must contain letters, can contain apostrophes
            return `<span class="speakable-word">${part}</span>`;
        } else {
            // It's whitespace or punctuation, return as is.
            return part;
        }
    }).join('');

    dom.storyDisplay.innerHTML = html;
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

    // Check if there's a pronunciation override for this word.
    if (currentPronunciations[lowerCaseText]) {
        textToSpeak = currentPronunciations[lowerCaseText];
    }
    
    // Find the element to highlight
    const elementToHighlight = activeWordElement;

    speakText(textToSpeak, elementToHighlight);
}

/**
 * The core speech synthesis function.
 * @param {string} textToSpeak The exact text to be spoken.
 * @param {HTMLElement} [elementToHighlight] Optional element to highlight while speaking.
 */
function speakText(textToSpeak, elementToHighlight = null) {
    if (!('speechSynthesis' in window)) {
        alert('Sorry, your browser does not support text-to-speech.');
        return;
    }
    // If speech is happening, calling cancel will trigger the 'onend' of the current utterance,
    // which will clean up the highlight. We need to ensure this happens before starting the new one.
    window.speechSynthesis.cancel();

    // Defensive cleanup for any orphaned highlights
    if (currentlySpeakingElement) {
        currentlySpeakingElement.classList.remove('speaking');
    }
    currentlySpeakingElement = elementToHighlight;

    console.log(`Speech Synthesis pronouncing: "${textToSpeak}"`);

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = 0.8; // Speak a bit slower for clarity
    utterance.lang = 'en-US'; // Hint to the TTS engine to use English pronunciation rules

    utterance.onstart = () => {
        if (currentlySpeakingElement) {
            currentlySpeakingElement.classList.add('speaking');
        }
    };

    utterance.onend = () => {
        if (currentlySpeakingElement) {
            currentlySpeakingElement.classList.remove('speaking');
            currentlySpeakingElement = null;
        }
    };

    window.speechSynthesis.speak(utterance);
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
 * Toggles the visibility of the reader and dashboard views.
 */
function toggleDashboard() {
    const isDashboardVisible = dom.dashboardView.classList.toggle('hidden');
    dom.readerView.classList.toggle('hidden', !isDashboardVisible);
    
    // Update button text and visibility based on view
    dom.toggleDashboardBtn.querySelector('span').textContent = isDashboardVisible ? 'Dashboard' : 'Back to Reader';
    dom.chooseStoryBtn.classList.toggle('hidden', !isDashboardVisible);
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
    dom.storyDisplay.classList.toggle('hidden', isCreatorMode);

    if (isCreatorMode) {
        dom.creatorModeBtn.querySelector('span').textContent = 'Exit Creator Mode';
        // If dashboard is not hidden, switch back to reader view to show the creator
        if (!dom.dashboardView.classList.contains('hidden')) {
            toggleDashboard();
        }
        currentStoryId = null; // Reset ID for new story
        sessionImages = {}; // Reset session images
        dom.storyInput.value = ''; // Clear the text area
        dom.storyInput.placeholder = 'Write your new story here...';
        renderPhoneticsEditor(); // Clear and render the phonetics editor
        renderPronunciationEditor(); // Clear and render the editor

    } else {
        dom.creatorModeBtn.querySelector('span').textContent = 'Enter Creator Mode';
        renderStory(); // Render whatever is in the text area when exiting
    }
}

/**
 * Opens the story selection modal.
 */
function openStoryModal() {
    dom.storyModal.classList.remove('hidden');
}

/**
 * Closes the story selection modal.
 */
function closeStoryModal() {
    dom.storyModal.classList.add('hidden');
}

/**
 * Updates the user's display name in local storage.
 * @param {Event} event 
 */
function updateDisplayName(event) {
    const name = event.target.value.trim();
    if (name) {
        localStorage.setItem('readinghelper_display_name', name);
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
        loadUserStory(storyId);
    } else if (target.closest('[data-path]')) {
        const storyItem = target.closest('.story-item');
        const path = storyItem.dataset.path;
        currentStoryPath = path; // Store the base path for the loaded story

        localImageUrls = {}; // Clear local images when loading a built-in story
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
            // Also populate the creator editors so the user can see the loaded guides.
            renderPhoneticsEditor(currentPhonetics);
            renderPronunciationEditor(currentPronunciations);

            closeStoryModal();
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
        storyManager.saveUserStory(story);

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
    const story = storyManager.getUserStoryById(storyId);
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
function loadUserStory(id) {
    const story = storyManager.getUserStoryById(id);
    if (!story) return;

    currentStoryId = story.id;
    currentStoryPath = '';

    dom.storyInput.value = story.content;

    renderPhoneticsEditor(story.phonetics || {});
    renderPronunciationEditor(story.pronunciations || {});

    localImageUrls = {};
    sessionImages = {};
    if (story.images) {
        for (const [name, base64] of Object.entries(story.images)) {
            sessionImages[name] = base64; // Keep for saving
            fetch(base64).then(res => res.blob()).then(blob => {
                localImageUrls[name] = URL.createObjectURL(blob);
            });
        }
    }

    closeStoryModal();
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
    const syllabifiedWord = getSyllables(word.trim());

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

    // Prevent default behavior like text selection on mobile
    event.preventDefault();

    isLongPress = false; // Reset flag
    popupWasShown = false; // Reset this flag on every new press
    pressTimer = setTimeout(() => {
        isLongPress = true;
        const originalWord = activeWordElement.textContent;
        showSyllablePopup(originalWord, activeWordElement);
    }, LONG_PRESS_DURATION);
}

/**
 * Handles the end of a press (mouseup or touchend) anywhere on the page.
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
        const word = activeWordElement.textContent.trim().toLowerCase();
        speakWordFromStory(word);
        trackWord(word);
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
            speakText(textToSpeak);
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
            const existing = storyManager.getUserStoryById(currentStoryId);
            if (existing && existing.images) {
                story.images = { ...existing.images };
            }
        }

        // Process images in text
        const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
        let match;
        while ((match = imageRegex.exec(storyText)) !== null) {
            const imagePath = match[1].trim();
            const imageName = imagePath.split('/').pop();
            if (sessionImages[imageName]) {
                story.images[imageName] = sessionImages[imageName];
            }
        }

        const savedStories = storyManager.saveUserStory(story);
        // Update current ID if it was a new story
        const savedStory = savedStories.find(s => s.title === title && s.content === storyText);
        if (savedStory) currentStoryId = savedStory.id;

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

    storyManager.deleteUserStory(storyId);
    await loadStoryLibrary();
}

// Initialize the application
init();