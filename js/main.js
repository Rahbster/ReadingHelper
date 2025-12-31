import * as peerService from './peer-service.js';
import { ToastManager } from './ToastManager.js';
import { showPeerConnectionModal } from './modals/peer_connection_modal.js';

const dom = {
    storyInput: document.getElementById('story-input'),
    storyDisplay: document.getElementById('story-display'),
    chooseStoryBtn: document.getElementById('choose-story-btn'),
    storyBadge: document.getElementById('story-badge'),
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
    previewBanner: document.getElementById('preview-banner'),
    previewAcceptBtn: document.getElementById('preview-accept-btn'),
    previewDeclineBtn: document.getElementById('preview-decline-btn'),
    // Sidenav
    hamburgerBtn: document.getElementById('hamburger-btn'),
    sidenav: document.getElementById('sidenav'),
    closeSidenavBtn: document.getElementById('close-sidenav-btn'),
    overlay: document.getElementById('overlay'),
    themeToggle: document.getElementById('theme-toggle'),
    settingsNameInput: document.getElementById('settings-name'),
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
let currentStoryDirHandle = null; // Holds the directory handle for a story loaded from the computer
let sharedStoryHandles = {}; // Holds directory handles for shared stories, keyed by folder name
let localStoryHandles = {}; // Holds directory handles for local stories, keyed by folder name
let pendingStoryHandles = {}; // Holds directory handles for pending (inbox) stories
let isPeerConnected = false;

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

        // Preview Banner Buttons
        {
            element: dom.previewAcceptBtn,
            event: 'click',
            handler: () => {
                const { storyName, storyTitle } = dom.previewBanner.dataset;
                if (storyName && storyTitle) {
                    acceptPendingStory(storyName, storyTitle);
                    hidePreviewBanner();
                    openStoryModal(); // Go back to library to see it moved
                }
            }
        },
        {
            element: dom.previewDeclineBtn,
            event: 'click',
            handler: () => {
                const { storyName, storyTitle } = dom.previewBanner.dataset;
                if (storyName && storyTitle) {
                    declinePendingStory(storyName, storyTitle);
                    hidePreviewBanner();
                    dom.storyDisplay.innerHTML = '<p>The story will appear here. Tap on any word to hear it read aloud.</p>';
                    openStoryModal();
                }
            }
        },
        // Sidenav
        { element: dom.hamburgerBtn, event: 'click', handler: openNav },
        { element: dom.closeSidenavBtn, event: 'click', handler: closeNav },
        { element: dom.overlay, event: 'click', handler: closeNav },
        { element: dom.themeToggle, event: 'click', handler: toggleTheme },
        { element: dom.settingsNameInput, event: 'change', handler: updateDisplayName },
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
            dom.connectBtn.textContent = 'Connect';
            dom.connectBtn.classList.remove('connected');
            loadStoryLibrary(); // Refresh to hide share buttons
        }
    } else {
        showPeerConnectionModal(toastManager, {
            appPrefix: 'readinghelper',
            peerPrefix: 'readinghelper-',
            onDataReceived: (data) => {
                if (data.type === 'story-transfer') handleStoryTransfer(data);
            },
            onConnectionChange: (connected) => {
                isPeerConnected = connected;
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
    dom.storyList.innerHTML = ''; // Clear the list first

    // Load stories from other sources
    await loadSharedStories();
    await loadMyStories();
    await loadPendingStories();
}

/**
 * Finds stories in the 'my_stories' directory of the Origin Private File System.
 */
async function loadMyStories() {
    try {
        const root = await navigator.storage.getDirectory();
        const myStoriesDir = await root.getDirectoryHandle('my_stories', { create: true });

        const localStories = [];
        localStoryHandles = {}; // Reset the cache

        for await (const entry of myStoriesDir.values()) {
            if (entry.kind === 'directory') {
                // To be considered a story, a directory must contain 'story.txt'
                try {
                    await entry.getFileHandle('story.txt');
                    const title = entry.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    localStoryHandles[entry.name] = entry; // Cache the handle
                    localStories.push({ title, name: entry.name });
                } catch (e) {
                    // This directory is not a story folder, ignore it.
                }
            }
        }

        if (localStories.length > 0) {
            addLocalStoriesToModal(localStories);
        }
    } catch (error) {
        console.error('Error loading stories from OPFS:', error);
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
        `<div class="story-item" data-local-story-name="${story.name}" data-title="${story.title}">
            <span class="story-item-title">${story.title}</span>
            ${isPeerConnected ? `<button class="theme-button story-share-btn" data-local-story-name="${story.name}" title="Share story">Share</button>` : ''}
            <button class="theme-button story-delete-btn destructive" data-local-story-name="${story.name}" title="Delete story">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                <span>Delete</span>
            </button>
        </div>`
    ).join('');
    contentArea.innerHTML = newStoriesHtml; // Use innerHTML to replace content on refresh
}

/**
 * Finds stories in the Origin Private File System and adds them to the story modal.
 */
async function loadSharedStories() {
    try {
        const root = await navigator.storage.getDirectory();
        const sharedDir = await root.getDirectoryHandle('shared_stories');
        
        const sharedStories = [];
        for await (const entry of sharedDir.values()) {
            if (entry.kind === 'directory') {
                const title = entry.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                sharedStoryHandles[entry.name] = entry; // Cache the handle
                sharedStories.push({ title, name: entry.name });
            }
        }

        if (sharedStories.length > 0) {
            addSharedStoriesToModal(sharedStories);
        }
    } catch (e) {
        // This is not an error, it just means no stories have been shared yet.
        console.log('No shared stories directory found.');
    }
}

/**
 * Adds a list of shared stories to the UI.
 * @param {Array<object>} stories - An array of story objects with title and name properties.
 */
function addSharedStoriesToModal(stories) {
    let group = dom.storyList.querySelector('#shared-stories-group');
    if (!group) {
        dom.storyList.insertAdjacentHTML('beforeend', `
            <div id="shared-stories-group" class="story-group">
                <div class="story-group-header">Shared Stories</div>
                <div class="story-group-content"></div>
            </div>
        `);
        group = dom.storyList.querySelector('#shared-stories-group');
    }

    const contentArea = group.querySelector('.story-group-content');
    const newStoriesHtml = stories.map(story => 
        `<div class="story-item" data-shared-story-name="${story.name}">
            <span class="story-item-title">${story.title}</span>
            <button class="theme-button story-delete-btn destructive" data-shared-story-name="${story.name}" title="Delete story">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                <span>Delete</span>
            </button>
        </div>`
    ).join('');
    contentArea.insertAdjacentHTML('beforeend', newStoriesHtml);
}

/**
 * Finds stories in the 'pending_stories' directory (Inbox) and adds them to the modal.
 */
async function loadPendingStories() {
    try {
        const root = await navigator.storage.getDirectory();
        const pendingDir = await root.getDirectoryHandle('pending_stories', { create: true });
        
        const pendingStories = [];
        pendingStoryHandles = {}; // Reset cache

        for await (const entry of pendingDir.values()) {
            if (entry.kind === 'directory') {
                const title = entry.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                pendingStoryHandles[entry.name] = entry;
                pendingStories.push({ title, name: entry.name });
            }
        }

        // Update badge on main menu
        if (dom.storyBadge) {
            dom.storyBadge.textContent = pendingStories.length;
            dom.storyBadge.classList.toggle('hidden', pendingStories.length === 0);
        }

        if (pendingStories.length > 0) {
            let group = dom.storyList.querySelector('#pending-stories-group');
            if (!group) {
                dom.storyList.insertAdjacentHTML('afterbegin', `
                    <div id="pending-stories-group" class="story-group" style="border-color: var(--highlight-color);">
                        <div class="story-group-header" style="background-color: var(--highlight-color); color: #333;">New Arrivals (Inbox)</div>
                        <div class="story-group-content"></div>
                    </div>
                `);
                group = dom.storyList.querySelector('#pending-stories-group');
            }
            const contentArea = group.querySelector('.story-group-content');
            contentArea.innerHTML = pendingStories.map(story => 
                `<div class="story-item" data-pending-story-name="${story.name}" data-title="${story.title}" title="Preview story">
                    <span class="story-item-title">${story.title}</span>
                    <span style="font-size: 0.8em; color: #666; margin-left: 10px;">Tap to Preview</span>
                </div>`
            ).join('');
        } else {
            // Remove group if empty
            const group = dom.storyList.querySelector('#pending-stories-group');
            if (group) group.remove();
        }
    } catch (e) {
        console.log('No pending stories directory found.');
    }
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
 * Shows the preview banner with data for the pending story.
 */
function showPreviewBanner(storyName, storyTitle) {
    if (!dom.previewBanner) return;
    dom.previewBanner.dataset.storyName = storyName;
    dom.previewBanner.dataset.storyTitle = storyTitle;
    dom.previewBanner.classList.remove('hidden');
}

/**
 * Hides the preview banner.
 */
function hidePreviewBanner() {
    if (dom.previewBanner) dom.previewBanner.classList.add('hidden');
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
    } else if (target.classList.contains('story-delete-btn')) {
        const storyTitle = target.closest('.story-item').querySelector('.story-item-title').textContent;
        if (target.dataset.sharedStoryName) {
            deleteSharedStory(target.dataset.sharedStoryName, storyTitle);
        } else if (target.dataset.localStoryName) {
            deleteMyStory(target.dataset.localStoryName, storyTitle);
        }
    } else if (target.classList.contains('story-share-btn')) {
        const storyName = target.dataset.localStoryName;
        const storyTitle = target.closest('.story-item').querySelector('.story-item-title').textContent;
        shareStory(storyName, storyTitle);
    } else if (target.closest('[data-pending-story-name]')) {
        const storyItem = target.closest('[data-pending-story-name]');
        const storyName = storyItem.dataset.pendingStoryName;
        const storyTitle = storyItem.dataset.title;
        const dirHandle = pendingStoryHandles[storyName];
        if (dirHandle) {
            await loadStoryFromDirectory(dirHandle, true); // isPreview = true
            showPreviewBanner(storyName, storyTitle);
        }
    } else if (target.closest('[data-shared-story-name]')) {
        const storyItem = target.closest('[data-shared-story-name]');
        const storyName = storyItem.dataset.sharedStoryName;
        const dirHandle = sharedStoryHandles[storyName];
        if (dirHandle) await loadStoryFromDirectory(dirHandle);
    } else if (target.closest('[data-local-story-name]')) {
        const storyName = target.closest('[data-local-story-name]').dataset.localStoryName;
        const dirHandle = localStoryHandles[storyName];
        if (dirHandle) await loadStoryFromDirectory(dirHandle);
    } else if (target.closest('[data-path]')) {
        const storyItem = target.closest('.story-item');
        const path = storyItem.dataset.path;
        currentStoryPath = path; // Store the base path for the loaded story

        currentStoryDirHandle = null; // Clear local directory handle when loading from web/default
        localImageUrls = {}; // Clear local images when loading a built-in story
        // CRITICAL: Clear previous guides from memory before fetching new ones.
        currentPhonetics = {};
        currentPronunciations = {};
        hidePreviewBanner();

        // Fetch all parts of the story module
        try {
            const [storyResponse, phoneticsResponse, pronunciationsResponse] = await Promise.all([
                fetch(`${path}story.txt`),
                fetch(`${path}phonetics.json`).catch(() => ({ json: () => ({}) })), // Gracefully fail
                fetch(`${path}pronunciations.json`).catch(() => ({ json: () => ({}) })) // Gracefully fail
            ]);

            const storyText = await storyResponse.text();
            currentPhonetics = await phoneticsResponse.json();
            currentPronunciations = await pronunciationsResponse.json();

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
    currentStoryDirHandle = null; // Clear local directory handle when loading from web

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
        // Use the File System Access API to save the received files.
        // We'll save it to a 'pending_stories' directory (Inbox) first.
        const root = await navigator.storage.getDirectory();
        const pendingDir = await root.getDirectoryHandle('pending_stories', { create: true });
        const folderName = storyTitle.toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]/g, '');
        const storyDirHandle = await pendingDir.getDirectoryHandle(folderName, { create: true });

        for (const [fileName, content] of Object.entries(storyPackage.files)) {
            let fileHandle;
            let writable;

            if (fileName.startsWith('images/')) {
                // Handle images which are Base64 encoded
                const imageDirHandle = await storyDirHandle.getDirectoryHandle('images', { create: true });
                const imageName = fileName.split('/').pop();
                fileHandle = await imageDirHandle.getFileHandle(imageName, { create: true });
                writable = await fileHandle.createWritable();
                // Convert Base64 back to a Blob to write the file
                const fetchRes = await fetch(content);
                const blob = await fetchRes.blob();
                await writable.write(blob);
            } else {
                // Handle text files (.txt, .json)
                fileHandle = await storyDirHandle.getFileHandle(fileName, { create: true });
                writable = await fileHandle.createWritable();
                await writable.write(content);
            }
            await writable.close();
        }

        toastManager.show(`Received story: "${storyTitle}". Check "New Arrivals" in the library.`, 'info', 5000);
        
        // Refresh library to show in "New Arrivals"
        await loadStoryLibrary();

    } catch (error) {
        console.error('Error receiving or saving story:', error);
        toastManager.show('Failed to save received story.', 'error');
    }
}

/**
 * Deletes a shared story from the Origin Private File System.
 * @param {string} storyName - The folder name of the story to delete.
 * @param {string} storyTitle - The display title of the story for the confirmation prompt.
 */
async function deleteSharedStory(storyName, storyTitle) {
    if (!confirm(`Are you sure you want to permanently delete the story "${storyTitle}"?`)) {
        return;
    }

    try {
        const root = await navigator.storage.getDirectory();
        const sharedDir = await root.getDirectoryHandle('shared_stories');
        await sharedDir.removeEntry(storyName, { recursive: true });

        // Remove from UI
        const storyItemElement = dom.storyList.querySelector(`.story-item[data-shared-story-name="${storyName}"]`);
        if (storyItemElement) {
            const groupContent = storyItemElement.parentElement;
            storyItemElement.remove();

            // If the shared stories group content is now empty, remove the whole group.
            if (groupContent && groupContent.classList.contains('story-group-content') && groupContent.children.length === 0) {
                const storyGroup = groupContent.parentElement;
                if (storyGroup && storyGroup.id === 'shared-stories-group') {
                    storyGroup.remove();
                }
            }
        }
        delete sharedStoryHandles[storyName]; // Remove from cached handles

    } catch (error) {
        console.error(`Error deleting story "${storyName}":`, error);
        alert('Could not delete the story. See the console for more details.');
    }
}

/**
 * Moves a story from Pending (Inbox) to Shared (Accepted).
 */
async function acceptPendingStory(storyName, storyTitle) {
    try {
        const root = await navigator.storage.getDirectory();
        const pendingDir = await root.getDirectoryHandle('pending_stories');
        const sharedDir = await root.getDirectoryHandle('shared_stories', { create: true });
        
        const sourceHandle = await pendingDir.getDirectoryHandle(storyName);
        const destHandle = await sharedDir.getDirectoryHandle(storyName, { create: true });

        // Copy files recursively
        await copyDirectory(sourceHandle, destHandle);

        // Remove from pending
        await pendingDir.removeEntry(storyName, { recursive: true });

        toastManager.show(`Story "${storyTitle}" accepted!`, 'success');
        
        // Refresh library and load the story
        await loadStoryLibrary();
        
        // Load it immediately
        const newSharedHandle = sharedStoryHandles[storyName]; // Should be populated by loadStoryLibrary
        if (newSharedHandle) {
            await loadStoryFromDirectory(newSharedHandle);
        }
    } catch (error) {
        console.error('Error accepting story:', error);
        toastManager.show('Error accepting story.', 'error');
    }
}

/**
 * Declines and deletes a story from the Pending (Inbox) area.
 */
async function declinePendingStory(storyName, storyTitle) {
    try {
        const root = await navigator.storage.getDirectory();
        const pendingDir = await root.getDirectoryHandle('pending_stories');
        await pendingDir.removeEntry(storyName, { recursive: true });
        await loadStoryLibrary();
        toastManager.show(`Declined story: "${storyTitle}"`, 'info');
    } catch (error) {
        console.error(`Error declining story "${storyName}":`, error);
        toastManager.show('Could not decline the story.', 'error');
    }
}

/**
 * Packages and sends a story to the connected peer.
 * @param {string} storyName - The name (folder name) of the local story to share.
 * @param {string} storyTitle - The title of the story.
 */
async function shareStory(storyName, storyTitle) {    
    const dirHandle = localStoryHandles[storyName];
    if (!dirHandle) {
        alert('Could not find the local story to share.');
        return;
    }
    console.log(`Packaging story: ${storyTitle} from local directory handle.`);

    try {
        // --- Pre-flight check for missing files ---
        const missingFiles = [];
        let storyText;

        // 1. Check for story.txt (critical)
        try {
            const storyFileHandle = await dirHandle.getFileHandle('story.txt');
            const storyFile = await storyFileHandle.getFile();
            storyText = await storyFile.text();
        } catch (e) {
            missingFiles.push('story.txt');
        }

        // 2. If story.txt exists, check for referenced images
        if (storyText) {
            const imageRegex = /\[IMAGE:\s*images\/(.*?)\s*\]/g;
            let match;
            let imagesDirHandle;
            try {
                imagesDirHandle = await dirHandle.getDirectoryHandle('images');
            } catch (e) {
                // If the images directory doesn't exist but is referenced, all images are missing.
            }

            while ((match = imageRegex.exec(storyText)) !== null) {
                const imageName = match[1];
                if (imagesDirHandle) {
                    try {
                        await imagesDirHandle.getFileHandle(imageName);
                    } catch (e) {
                        missingFiles.push(`images/${imageName}`);
                    }
                } else {
                    // No images directory, so the file is definitely missing.
                    missingFiles.push(`images/${imageName}`);
                }
            }
        }

        if (missingFiles.length > 0) {
            const missingFilesList = missingFiles.map(f => `- ${f}`).join('\n');
            alert(`Cannot share story "${storyTitle}". The following files are missing:\n\n${missingFilesList}\n\nPlease add these files to the story folder or correct the story text.`);
            return;
        }
        // --- End of pre-flight check ---


        const storyPackage = {
            type: 'story-transfer',
            title: storyTitle,
            files: {}
        };

        // 1. Read the core text and JSON files from the directory handle
        const fileNames = ['story.txt', 'phonetics.json', 'pronunciations.json'];
        for (const fileName of fileNames) {
            try {
                const fileHandle = await dirHandle.getFileHandle(fileName);
                const file = await fileHandle.getFile();
                storyPackage.files[fileName] = await file.text();
            } catch (e) {
                console.warn(`Could not read optional file: ${fileName}`);
            }
        }

        // 2. Parse story.txt to find and read images
        // storyText is already loaded from the pre-flight check
        if (storyText) {
            const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
            let match;
            const imagePromises = [];

            try {
                const imagesDirHandle = await dirHandle.getDirectoryHandle('images');
                while ((match = imageRegex.exec(storyText)) !== null) {
                    const imagePath = match[1].trim(); // e.g., 'images/house.png'
                    const imageName = imagePath.split('/').pop();
                    imagePromises.push(
                        imagesDirHandle.getFileHandle(imageName)
                        .then(fileHandle => fileHandle.getFile())
                        .then(blob => new Promise(resolve => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(blob);
                        }))
                        .then(base64 => (storyPackage.files[imagePath] = base64))
                    );
                }
            } catch (e) {
                console.log('No images directory found in this local story, or could not read images.');
            }
            await Promise.all(imagePromises);
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
 * Loads a story from a given directory handle.
 * This is a refactor of handleLoadFromComputer to be more reusable.
 * @param {FileSystemDirectoryHandle} dirHandle The handle to the story's directory.
 */
async function loadStoryFromDirectory(dirHandle, isPreview = false) {
    try {
        if (!isPreview) {
            hidePreviewBanner();
        }

        // Reset state for the new story
        currentStoryPath = ''; // Local stories don't have a web path
        localImageUrls = {};
        currentPhonetics = {};
        currentPronunciations = {};

        // 1. Load story.txt
        const storyFileHandle = await dirHandle.getFileHandle('story.txt');
        const storyFile = await storyFileHandle.getFile();
        dom.storyInput.value = await storyFile.text();

        // 2. Load phonetics.json (optional)
        try {
            const phoneticsFileHandle = await dirHandle.getFileHandle('phonetics.json');
            const phoneticsFile = await phoneticsFileHandle.getFile();
            const phonetics = JSON.parse(await phoneticsFile.text());
            renderPhoneticsEditor(phonetics);
        } catch (e) {
            renderPhoneticsEditor();
        }

        // 3. Load pronunciations.json (optional)
        try {
            const pronunciationsFileHandle = await dirHandle.getFileHandle('pronunciations.json');
            const pronunciationsFile = await pronunciationsFileHandle.getFile();
            const pronunciations = JSON.parse(await pronunciationsFile.text());
            renderPronunciationEditor(pronunciations);
        } catch (e) {
            renderPronunciationEditor();
        }

        // 4. Load images from the 'images' subdirectory (optional)
        try {
            const imagesDirHandle = await dirHandle.getDirectoryHandle('images');
            for await (const entry of imagesDirHandle.values()) {
                if (entry.kind === 'file') {
                    const imageFile = await entry.getFile();
                    localImageUrls[entry.name] = URL.createObjectURL(imageFile);
                }
            }
        } catch (e) {
            // It's okay if the images directory doesn't exist.
        }

        closeStoryModal();
        currentStoryDirHandle = dirHandle; // Store the handle for potential re-saving
        renderStory(); // Always render in reader view first.
    } catch (error) {
        console.error('Error in loadStoryFromDirectory:', error);
        alert('Could not load the story from the selected directory.');
    }
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
    try {
        const [fileHandle] = await window.showOpenFilePicker({
            types: [{ description: 'Images', accept: { 'image/*': ['.png', '.gif', '.jpeg', '.jpg'] } }],
        });

        const file = await fileHandle.getFile();
        const fileName = file.name;

        // Get a handle to a 'user_stories' directory.
        const root = await navigator.storage.getDirectory();
        const userStoriesDir = await root.getDirectoryHandle('user_stories', { create: true });
        const imagesDir = await userStoriesDir.getDirectoryHandle('images', { create: true });

        // Write the file to the new location.
        const newFileHandle = await imagesDir.getFileHandle(fileName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(file);
        await writable.close();

        console.log(`Image '${fileName}' saved to 'user_stories/images/'`);

        // Insert the image tag into the textarea at the current cursor position.
        const imageTag = `[IMAGE: images/${fileName}]`;
        const { selectionStart, selectionEnd, value } = dom.storyInput;
        dom.storyInput.value = value.slice(0, selectionStart) + imageTag + value.slice(selectionEnd);

    } catch (error) {
        // It's common for users to cancel the file picker, so we only log non-AbortError errors.
        if (error.name !== 'AbortError') {
            console.error('Error adding image:', error);
            alert('Could not add the image. Please ensure you are using a compatible browser (like Chrome or Edge) and have granted permissions.');
        }
    }
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

        // Now, get the title.
        const title = prompt('Please enter a title for your story (this will be the folder name):');
        if (!title) return; // User cancelled

        const folderName = title.toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]/g, '');
        if (!folderName) {
            alert('Invalid title. Please use letters and numbers.');
            return;
        }

        // Get a handle to the 'my_stories' directory in OPFS
        const root = await navigator.storage.getDirectory();
        const myStoriesDir = await root.getDirectoryHandle('my_stories', { create: true });
        const storyDirHandle = await myStoriesDir.getDirectoryHandle(folderName, { create: true });

        // 1. Save the story.txt file
        const storyFileHandle = await storyDirHandle.getFileHandle('story.txt', { create: true });
        let writable = await storyFileHandle.createWritable();
        await writable.write(storyText);
        await writable.close();

        // 2. Save the phonetics.json file
        const phoneticsFileHandle = await storyDirHandle.getFileHandle('phonetics.json', { create: true });
        writable = await phoneticsFileHandle.createWritable();
        await writable.write(phoneticsContent);
        await writable.close();

        // 3. Save the pronunciations.json file
        const pronunciationsFileHandle = await storyDirHandle.getFileHandle('pronunciations.json', { create: true });
        writable = await pronunciationsFileHandle.createWritable();
        await writable.write(pronunciationsContent);
        await writable.close();


        // 4. Find all images in the text and save them.
        const imageRegex = /\[IMAGE:\s*images\/(.*?)\s*\]/g;
        let match;
        const imageSaves = [];

        // Get handle to the OPFS images directory
        const opfsImagesDir = await root.getDirectoryHandle('user_stories', { create: true }).then(d => d.getDirectoryHandle('images', { create: true }));

        while ((match = imageRegex.exec(storyText)) !== null) {
            const imageName = match[1];
            imageSaves.push(
                (async () => {
                    try {
                        // Attempt to get the image from OPFS. This will only succeed for images added in the current session.
                        const imageFileHandle = await opfsImagesDir.getFileHandle(imageName);
                        const imageFile = await imageFileHandle.getFile();

                        // If successful, copy it to the destination directory.
                        const targetImagesDirHandle = await storyDirHandle.getDirectoryHandle('images', { create: true });
                        const newImageFileHandle = await targetImagesDirHandle.getFileHandle(imageName, { create: true });
                        const imageWritable = await newImageFileHandle.createWritable();
                        await imageWritable.write(imageFile);
                        await imageWritable.close();
                    } catch (opfsError) {
                        // Image not in OPFS. Try to copy it from the original source.
                        let imageBlob = null;
                        if (currentStoryDirHandle) {
                            // Source is a local directory
                            const sourceImagesDir = await currentStoryDirHandle.getDirectoryHandle('images');
                            const sourceImageHandle = await sourceImagesDir.getFileHandle(imageName);
                            imageBlob = await sourceImageHandle.getFile();
                        } else if (currentStoryPath) {
                            // Source is a web URL
                            const imageUrl = new URL(`images/${imageName}`, currentStoryPath).href;
                            const response = await fetch(imageUrl);
                            if (response.ok) {
                                imageBlob = await response.blob();
                            }
                        }

                        if (imageBlob) {
                            const targetImagesDirHandle = await storyDirHandle.getDirectoryHandle('images', { create: true });
                            const newImageFileHandle = await targetImagesDirHandle.getFileHandle(imageName, { create: true });
                            const imageWritable = await newImageFileHandle.createWritable();
                            await imageWritable.write(imageBlob);
                            await imageWritable.close();
                        } else {
                            console.log(`Could not find source for image '${imageName}', skipping copy.`);
                        }
                    }
                })()
            );
        }

        await Promise.all(imageSaves);

        alert(`Story "${title}" and its images saved successfully!`);
        await loadStoryLibrary(); // Refresh list

    } catch (error) {
        console.error('Error saving story:', error);
        alert('Could not save the story.');
    }
}

/**
 * Deletes a user-created story from the Origin Private File System.
 * @param {string} storyName - The folder name of the story to delete.
 * @param {string} storyTitle - The display title of the story for the confirmation prompt.
 */
async function deleteMyStory(storyName, storyTitle) {
    if (!confirm(`Are you sure you want to permanently delete your story "${storyTitle}"?`)) {
        return;
    }

    try {
        const root = await navigator.storage.getDirectory();
        const myStoriesDir = await root.getDirectoryHandle('my_stories');
        await myStoriesDir.removeEntry(storyName, { recursive: true });
        await loadStoryLibrary();
    } catch (error) {
        console.error(`Error deleting story "${storyName}":`, error);
        alert('Could not delete the story.');
    }
}

/**
 * Helper to recursively copy a directory handle content to another.
 */
async function copyDirectory(sourceHandle, destHandle) {
    for await (const entry of sourceHandle.values()) {
        if (entry.kind === 'file') {
            const sourceFile = await entry.getFile();
            const destFileHandle = await destHandle.getFileHandle(entry.name, { create: true });
            const writable = await destFileHandle.createWritable();
            await writable.write(sourceFile);
            await writable.close();
        } else if (entry.kind === 'directory') {
            const newDestSubDir = await destHandle.getDirectoryHandle(entry.name, { create: true });
            const newSourceSubDir = await sourceHandle.getDirectoryHandle(entry.name);
            await copyDirectory(newSourceSubDir, newDestSubDir);
        }
    }
}

// Initialize the application
init();