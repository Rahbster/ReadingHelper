const dom = {
    storyInput: document.getElementById('story-input'),
    loadStoryBtn: document.getElementById('load-story-btn'),
    storyDisplay: document.getElementById('story-display'),
    toggleDashboardBtn: document.getElementById('toggle-dashboard-btn'),
    readerView: document.getElementById('reader-view'),
    dashboardView: document.getElementById('dashboard-view'),
    trickyWordsList: document.getElementById('tricky-words-list'),
    clearStatsBtn: document.getElementById('clear-stats-btn'),
};

const WORD_STATS_KEY = 'readingHelperWordStats';

/**
 * Main initialization function.
 */
function init() {
    loadWordStats();
    setupEventListeners();
    renderDashboard();
}

/**
 * Sets up all the event listeners for the application.
 */
function setupEventListeners() {
    dom.loadStoryBtn.addEventListener('click', renderStory);
    dom.storyDisplay.addEventListener('click', handleWordClick);
    dom.toggleDashboardBtn.addEventListener('click', toggleDashboard);
    dom.clearStatsBtn.addEventListener('click', clearAllStats);
}

/**
 * Renders the text from the input area into the story display area,
 * making each word interactive.
 */
function renderStory() {
    const text = dom.storyInput.value;
    if (!text.trim()) {
        dom.storyDisplay.innerHTML = '<p>Please paste a story into the text box above and click "Load Story".</p>';
        return;
    }

    // Split by spaces and punctuation, but keep them for rendering.
    // This regex splits on spaces, newlines, and common punctuation.
    const wordsAndPunctuation = text.split(/([ \n.,!?;:"'()])/);

    const html = wordsAndPunctuation.map(part => {
        // Check if the part is a word (contains letters)
        if (/[a-zA-Z]/.test(part)) {
            return `<span class="speakable-word">${part}</span>`;
        } else {
            // It's whitespace or punctuation, return as is.
            return part;
        }
    }).join('');

    dom.storyDisplay.innerHTML = html;
}

/**
 * Handles a click on a word, speaks it, and tracks the tap.
 * @param {Event} event The click event.
 */
function handleWordClick(event) {
    const target = event.target;
    if (!target.classList.contains('speakable-word')) return;

    const word = target.textContent.trim().toLowerCase();
    speakText(word);
    trackWord(word);
}

/**
 * Uses the Web Speech API to read a word aloud.
 * @param {string} text The text to speak.
 */
function speakText(text) {
    if (!('speechSynthesis' in window)) {
        alert('Sorry, your browser does not support text-to-speech.');
        return;
    }
    window.speechSynthesis.cancel(); // Stop any previous speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.8; // Speak a bit slower for clarity
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
    dom.readerView.classList.toggle('hidden');
    dom.dashboardView.classList.toggle('hidden');
    dom.toggleDashboardBtn.textContent = dom.readerView.classList.contains('hidden') ? 'Back to Reader' : 'Dashboard';
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

// Initialize the application
init();