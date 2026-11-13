/**
 * VoiceManager.js
 * Handles all speech synthesis, voice selection, and syllable breakdown logic.
 */

import { escapeHtml, cleanWordToken } from './utils/dom-utils.js';

export const VOICE_PREF_KEY = 'readingHelperSelectedVoice';

let currentlySpeakingElement = null;
let currentUtterance = null;

const HIGH_QUALITY_MARKERS = ['Natural', 'Google', 'Premium', 'Enhanced', 'Siri'];

/**
 * Helper to identify high-quality voices across different platforms.
 * @param {SpeechSynthesisVoice} v
 */
const isHighQuality = (v) => HIGH_QUALITY_MARKERS.some((marker) => v.name.toLowerCase().includes(marker.toLowerCase()));

/**
 * Warms up the speech engine to satisfy browser interaction requirements.
 */
export function warmUp() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && !window.speechSynthesis.speaking) {
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
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
            console.warn('Speech synthesis not supported in this browser.');
            resolve();
            return;
        }

        window.speechSynthesis.cancel();

        if (currentlySpeakingElement) {
            currentlySpeakingElement.classList.remove('speaking');
        }
        currentlySpeakingElement = elementToHighlight;

        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        currentUtterance = utterance;

        let voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) voices = window.speechSynthesis.getVoices();

        const savedVoiceName = localStorage.getItem(VOICE_PREF_KEY);
        const isUS = (v) => v.lang.toLowerCase().replace('_', '-').startsWith('en-us');
        const isEnglish = (v) => v.lang.toLowerCase().startsWith('en');
        const isLocal = (v) => v.localService === true;

        const preferredVoice =
            voices.find((v) => v.name === savedVoiceName) ||
            voices.find((v) => isUS(v) && isHighQuality(v) && isLocal(v)) ||
            voices.find((v) => isUS(v) && isHighQuality(v)) ||
            voices.find((v) => isEnglish(v) && isHighQuality(v) && isLocal(v)) ||
            voices.find((v) => isEnglish(v) && isHighQuality(v)) ||
            voices.find((v) => isUS(v)) ||
            voices.find((v) => isEnglish(v));

        if (preferredVoice) {
            utterance.voice = preferredVoice;
            utterance.lang = preferredVoice.lang;
        }

        let boundaryRafId = null;
        let latestBoundaryEvent = null;

        if (onBoundary) {
            utterance.onboundary = (event) => {
                if (event.name && event.name !== 'word') return;
                latestBoundaryEvent = event;
                if (boundaryRafId === null) {
                    boundaryRafId = requestAnimationFrame(() => {
                        boundaryRafId = null;
                        if (latestBoundaryEvent) {
                            onBoundary(latestBoundaryEvent);
                        }
                    });
                }
            };
        }

        const lengthFactor = textToSpeak.length <= 4 ? 0.90 : 1.0;
        utterance.rate = Math.max(0.8, rate * lengthFactor);
        utterance.pitch = textToSpeak.length <= 4 ? 1.05 : 1.0;
        utterance.volume = 1.0;

        utterance.onstart = () => {
            if (currentlySpeakingElement) {
                currentlySpeakingElement.classList.add('speaking');
            }
        };

        const cleanup = () => {
            if (boundaryRafId !== null) {
                cancelAnimationFrame(boundaryRafId);
                boundaryRafId = null;
            }
            if (currentlySpeakingElement) {
                currentlySpeakingElement.classList.remove('speaking');
                currentlySpeakingElement = null;
            }
            if (currentUtterance === utterance) {
                currentUtterance = null;
            }
        };

        utterance.onend = () => {
            cleanup();
            resolve();
        };

        utterance.onerror = (event) => {
            if (event.error !== 'interrupted' && event.error !== 'canceled') {
                console.error('SpeechSynthesisUtterance error', event);
            }
            cleanup();
            resolve();
        };

        const isMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const speakDelay = isMobile ? 120 : 30;

        setTimeout(() => {
            if (currentUtterance === utterance) {
                window.speechSynthesis.speak(utterance);
            } else {
                resolve();
            }
        }, speakDelay);
    });
}

/**
 * Populates a select element with available high-quality English voices.
 */
export function populateVoiceList(selectElement) {
    if (!selectElement || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    let voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) voices = window.speechSynthesis.getVoices();

    const savedVoiceName = localStorage.getItem(VOICE_PREF_KEY);
    const seenNames = new Set();

    const displayVoices = voices
        .filter((v) => {
            const lang = v.lang.toLowerCase().replace('_', '-');
            if (!lang.startsWith('en')) return false;
            const key = `${v.name}-${lang}`;
            if (seenNames.has(key)) return false;
            seenNames.add(key);
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
        html += displayVoices.map((voice) => {
            const isSelected = voice.name === savedVoiceName ? 'selected' : '';
            const safeName = escapeHtml(voice.name);
            const safeLang = escapeHtml(voice.lang);
            return `<option value="${safeName}" ${isSelected}>${safeName} (${safeLang})</option>`;
        }).join('');
    }
    selectElement.innerHTML = html;
}

/**
 * Breaks a word into syllables using phonetic overrides or vowel-consonant heuristics.
 * Strips outer quote marks so words inside dialogue match phonetic dictionaries cleanly.
 * @param {string} word
 * @param {Object<string,string>} [phonetics={}]
 * @returns {string}
 */
export function getSyllables(word, phonetics = {}) {
    const cleaned = cleanWordToken(word);
    if (!cleaned) return '';
    if (phonetics && phonetics[cleaned]) return phonetics[cleaned];
    if (cleaned.length <= 3) return cleaned;

    // Preserve hyphenated compounds first, then split syllables within each part
    return cleaned
        .split('-')
        .map((part) => {
            if (phonetics && phonetics[part]) return phonetics[part];
            if (part.length <= 3) return part;
            return part
                .replace(/([aeiouy])([bcdfghjklmnpqrstvwxz])([aeiouy])/g, '$1-$2$3')
                .replace(/([bcdfghjklmnpqrstvwxz])([bcdfghjklmnpqrstvwxz])([aeiouy])/g, '$1-$2$3');
        })
        .join('-');
}
