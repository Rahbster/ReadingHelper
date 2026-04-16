/**
 * VoiceManager.js
 * Handles all speech synthesis, voice selection, and syllable breakdown logic.
 */

export const VOICE_PREF_KEY = 'readingHelperSelectedVoice';

let currentlySpeakingElement = null;
let currentUtterance = null;

/**
 * Uses the Web Speech API to read text aloud.
 * @param {string} textToSpeak - The text to be spoken.
 * @param {HTMLElement} [elementToHighlight] - Optional element to highlight during speech.
 */
export function speakText(textToSpeak, elementToHighlight = null) {
    if (!('speechSynthesis' in window)) {
        console.warn('Speech synthesis not supported in this browser.');
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
    const isUS = (v) => v.lang.toLowerCase().replace('_', '-') === 'en-us';
    const isEnglish = (v) => v.lang.toLowerCase().startsWith('en');
    const isHighQuality = (v) => v.name.includes('Natural') || v.name.includes('Google');

    const preferredVoice = 
        voices.find(v => v.name === savedVoiceName)
        || voices.find(v => isUS(v) && isHighQuality(v))
        || voices.find(v => isEnglish(v) && isHighQuality(v)) 
        || voices.find(v => isUS(v))
        || voices.find(v => isEnglish(v));
    
    if (preferredVoice) {
        currentUtterance.voice = preferredVoice;
    }

    currentUtterance.rate = textToSpeak.length <= 4 ? 0.55 : 0.75;
    currentUtterance.pitch = textToSpeak.length <= 4 ? 1.15 : 1.0;
    currentUtterance.volume = 1.0;
    currentUtterance.lang = 'en-US';

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
    };

    currentUtterance.onerror = (event) => {
        console.error('SpeechSynthesisUtterance error', event);
        if (currentlySpeakingElement) {
            currentlySpeakingElement.classList.remove('speaking');
        }
    };

    setTimeout(() => {
        window.speechSynthesis.speak(currentUtterance);
    }, 50);
}

/**
 * Populates a select element with available high-quality English voices.
 */
export function populateVoiceList(selectElement) {
    if (!selectElement || !('speechSynthesis' in window)) return;

    const voices = window.speechSynthesis.getVoices();
    const savedVoiceName = localStorage.getItem(VOICE_PREF_KEY);

    const englishVoices = voices.filter(v => v.lang.toLowerCase().startsWith('en'))
                                .sort((a, b) => {
                                    const aHigh = a.name.includes('Natural') || a.name.includes('Google');
                                    const bHigh = b.name.includes('Natural') || b.name.includes('Google');
                                    if (aHigh && !bHigh) return -1;
                                    if (!aHigh && bHigh) return 1;
                                    return a.name.localeCompare(b.name);
                                });

    let html = `<option value="" ${!savedVoiceName ? 'selected' : ''}>-- Use Best Default --</option>`;
    if (englishVoices.length > 0) {
        html += englishVoices.map(voice => {
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