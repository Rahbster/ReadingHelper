/**
 * VoiceManager.js
 * Handles all speech synthesis, voice selection, and syllable breakdown logic.
 */

export const VOICE_PREF_KEY = 'readingHelperSelectedVoice';

let currentlySpeakingElement = null;
let currentUtterance = null;

const HIGH_QUALITY_MARKERS = ['Natural', 'Google', 'Premium', 'Enhanced', 'Siri'];

/**
 * Helper to identify high-quality voices across different platforms.
 * @param {SpeechSynthesisVoice} v 
 */
const isHighQuality = (v) => HIGH_QUALITY_MARKERS.some(marker => v.name.includes(marker));

/**
 * Warms up the speech engine to satisfy browser interaction requirements.
 */
export function warmUp() {
    if ('speechSynthesis' in window && !window.speechSynthesis.speaking) {
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }
}

/**
 * Uses the Web Speech API to read text aloud.
 * @param {string} textToSpeak - The text to be spoken.
 * @param {HTMLElement} [elementToHighlight] - Optional element to highlight during speech.
 * @param {Function} [onBoundary] - Optional callback for speech boundaries (receives event).
 * @param {number} [rate=1.0] - The base reading speed.
 */
export function speakText(textToSpeak, elementToHighlight = null, onBoundary = null, rate = 1.0) {
    return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
        console.warn('Speech synthesis not supported in this browser.');
        resolve();
        return;
    }

    window.speechSynthesis.cancel();

    if (currentlySpeakingElement) {
        currentlySpeakingElement.classList.remove('speaking');
    }
    currentlySpeakingElement = elementToHighlight;

    currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    
    let voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) voices = window.speechSynthesis.getVoices();

    const savedVoiceName = localStorage.getItem(VOICE_PREF_KEY);
    const isUS = (v) => v.lang.toLowerCase().replace('_', '-').startsWith('en-us');
    const isEnglish = (v) => v.lang.toLowerCase().startsWith('en');
    const isLocal = (v) => v.localService === true;

    const preferredVoice = 
        voices.find(v => v.name === savedVoiceName)
        || voices.find(v => isUS(v) && isHighQuality(v) && isLocal(v))
        || voices.find(v => isUS(v) && isHighQuality(v))
        || voices.find(v => isEnglish(v) && isHighQuality(v) && isLocal(v)) 
        || voices.find(v => isEnglish(v) && isHighQuality(v)) 
        || voices.find(v => isUS(v))
        || voices.find(v => isEnglish(v));
    
    if (preferredVoice) {
        currentUtterance.voice = preferredVoice;
        currentUtterance.lang = preferredVoice.lang;
    }

    if (onBoundary) {
        let lastUpdate = 0;
        currentUtterance.onboundary = (event) => {
            const now = performance.now();
            // Prevent firing boundary events too rapidly to avoid UI contention on mobile
            if (now - lastUpdate > 40) {
                onBoundary(event);
                lastUpdate = now;
            }
        };
    }

    const lengthFactor = textToSpeak.length <= 4 ? 0.90 : 1.0;
    currentUtterance.rate = Math.max(0.8, rate * lengthFactor);
    currentUtterance.pitch = textToSpeak.length <= 4 ? 1.05 : 1.0;
    currentUtterance.volume = 1.0;

    currentUtterance.onstart = () => {
        if (currentlySpeakingElement) {
            currentlySpeakingElement.classList.add('speaking');
        }
    };

    currentUtterance.onend = () => {
        if (currentlySpeakingElement) {
            currentlySpeakingElement.classList.remove('speaking');
            currentlySpeakingElement = null;
        }
        currentUtterance = null;
        resolve();
    };

    currentUtterance.onerror = (event) => {
        console.error('SpeechSynthesisUtterance error', event);
        if (currentlySpeakingElement) {
            currentlySpeakingElement.classList.remove('speaking');
        }
        resolve();
    };

    // iPad/iOS performance optimization: Increase delay to avoid main-thread contention during init
    const isMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const speakDelay = isMobile ? 150 : 50;

    setTimeout(() => {
        window.speechSynthesis.speak(currentUtterance);
    }, speakDelay);
    });
}

/**
 * Populates a select element with available high-quality English voices.
 */
export function populateVoiceList(selectElement) {
    if (!selectElement || !('speechSynthesis' in window)) return;

    // Some browsers return an empty list on the first call; 
    // calling it twice or waiting for the event is necessary.
    let voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) voices = window.speechSynthesis.getVoices();

    const savedVoiceName = localStorage.getItem(VOICE_PREF_KEY);
    const seenNames = new Set();

    const displayVoices = voices.filter(v => {
                                    if (!v.lang.toLowerCase().startsWith('en')) return false;
                                    if (seenNames.has(v.name)) return false;
                                    seenNames.add(v.name);
                                    return true;
                                })
                                .sort((a, b) => {
                                    const aHigh = isHighQuality(a);
                                    const bHigh = isHighQuality(b);
                                    if (aHigh && !bHigh) return -1;
                                    if (!aHigh && bHigh) return 1;
                                    return a.name.localeCompare(b.name);
                                });

    let html = `<option value="" ${!savedVoiceName ? 'selected' : ''}>-- Use Best Default --</option>`;
    if (displayVoices.length > 0) {
        html += displayVoices.map(voice => {
            const isSelected = voice.name === savedVoiceName ? 'selected' : '';
            return `<option value="${voice.name}" ${isSelected}>${voice.name} (${voice.lang})</option>`;
        }).join('');
    }
    selectElement.innerHTML = html;
}

/**
 * Breaks a word into syllables using heuristics or phonetic overrides.
 */
export function getSyllables(word, phonetics = {}) {
    const lowerCaseWord = word.toLowerCase();
    if (phonetics[lowerCaseWord]) return phonetics[lowerCaseWord];
    if (word.length <= 3) return word.toLowerCase();

    return word.toLowerCase()
               .replace(/([aeiouy])([bcdfghjklmnpqrstvwxz])([aeiouy])/g, '$1-$2$3')
               .replace(/([bcdfghjklmnpqrstvwxz])([bcdfghjklmnpqrstvwxz])([aeiouy])/g, '$1-$2$3');
}