/**
 * VoiceManager.js
 * Handles speech synthesis, natural speech normalization, voice ranking, and syllable breakdown.
 */

import { escapeHtml, cleanWordToken } from './utils/dom-utils.js';

export const VOICE_PREF_KEY = 'readingHelperSelectedVoice';

let currentlySpeakingElement = null;
let currentUtterance = null;

const HIGH_QUALITY_MARKERS = ['Natural', 'Neural', 'Premium', 'Enhanced', 'Siri', 'Google'];

const PREFERRED_STORYTELLER_NAMES = [
    'Ava',
    'Aria',
    'Jenny',
    'Emma',
    'Samantha',
    'Allison',
    'Nicky',
    'Siri',
    'Zira',
    'Google US English',
    'Karen',
    'Moira',
    'Daniel',
    'Alex'
];

const NOVELTY_VOICE_NAMES = [
    'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos',
    'Deranged', 'Good News', 'Hysterical', 'Jester', 'Organ', 'Superstar',
    'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Ralph', 'Kathy'
];

// Initialisms that should remain uppercase if written in ALL-CAPS
const PRESERVED_ACRONYMS = new Set(['TV', 'USA', 'UK', 'DJ', 'PJ', 'ID', 'OK']);

// Expressive interjections and stretched words mapped to TTS-friendly spellings
const INTERJECTION_PATTERNS = [
    [/^a+h+$/i, 'aah'],        // "Ah", "Ahh", "Ahhh" -> "aah" (never letter "A")
    [/^o+h{2,}$/i, 'oh'],      // "Ohh", "Ohhh" -> "oh"
    [/^o{3,}$/i, 'ooh'],       // "Ooo", "Oooo" -> "ooh"
    [/^u+h{2,}$/i, 'uh'],      // "Uhh", "Uhhh" -> "uh"
    [/^u+m{2,}$/i, 'um'],      // "Umm", "Ummm" -> "um"
    [/^woah$/i, 'whoa'],       // "Woah" -> "whoa"
    [/^sh{2,}$/i, 'shh'],      // "Shhh" -> "shh"
    [/^hm{2,}$/i, 'hmm'],      // "Hmmm" -> "hmm"
    [/^m{3,}$/i, 'mmm'],       // "Mmmm" -> "mmm"
    [/^z{3,}$/i, 'zzz'],       // "Zzzz" -> "zzz"
    [/^br{3,}$/i, 'brr'],      // "Brrrr" -> "brr"
    [/^gr{3,}$/i, 'grr'],      // "Grrrr" -> "grr"
    [/^no{2,}$/i, 'no'],       // "Nooo" -> "no" (avoids "n-oo")
    [/^so{2,}$/i, 'so'],       // "Sooo" -> "so" (avoids "s-oo")
    [/^go{2,}$/i, 'go'],       // "Gooo" -> "go" (avoids "goo")
    [/^to{3,}$/i, 'too'],      // "Tooo" -> "too"
    [/^yes{2,}$/i, 'yes'],     // "Yesss" -> "yes"
    [/^buz{2,}$/i, 'buzz'],    // "Buzzz" -> "buzz"
    [/^his{3,}$/i, 'hiss'],    // "Hisss" -> "hiss"
    [/^pur{3,}$/i, 'purr'],    // "Purrr" -> "purr"
    [/^wel{3,}$/i, 'well'],    // "Welll" -> "well"
    [/^al{3,}$/i, 'all'],      // "Alll" -> "all"
    [/^ya+y+$/i, 'yay'],       // "Yayyy" -> "yay"
    [/^whe{2,}$/i, 'whee'],    // "Wheee" -> "whee"
    [/^wa{2,}h*$/i, 'waah'],   // "Waaah" -> "waah"
    [/^zo{2,}m+$/i, 'zoom']    // "Zooom" -> "zoom"
];

const isHighQuality = (v) => HIGH_QUALITY_MARKERS.some((m) => v.name.toLowerCase().includes(m.toLowerCase()));
const isNoveltyVoice = (v) => NOVELTY_VOICE_NAMES.some((m) => v.name.toLowerCase().includes(m.toLowerCase()));

/**
 * Scores an English voice for warm, natural storytelling quality.
 * @param {SpeechSynthesisVoice} v
 * @returns {number}
 */
function scoreVoice(v) {
    const nameLower = v.name.toLowerCase();
    const langLower = v.lang.toLowerCase().replace('_', '-');
    let score = 0;

    if (isNoveltyVoice(v)) return -100;

    if (langLower.startsWith('en-us')) score += 30;
    else if (langLower.startsWith('en-gb') || langLower.startsWith('en-au') || langLower.startsWith('en-ca')) score += 20;
    else if (langLower.startsWith('en')) score += 10;

    if (nameLower.includes('natural') || nameLower.includes('neural')) score += 55;
    else if (nameLower.includes('premium') || nameLower.includes('enhanced') || nameLower.includes('siri')) score += 50;
    else if (nameLower.includes('google')) score += 40;

    // Bonus for warm storyteller voices (and avoids stiff default Microsoft David when Zira/Aria exist)
    const nameMatchIndex = PREFERRED_STORYTELLER_NAMES.findIndex((n) => nameLower.includes(n.toLowerCase()));
    if (nameMatchIndex !== -1) {
        score += Math.max(8, 26 - nameMatchIndex);
    }

    // Slight bonus for local voices within the same quality tier (instant start & native word boundaries)
    if (v.localService) score += 5;

    return score;
}

/**
 * Normalizes a single story word token for natural TTS pronunciation without altering visual display.
 * Handles custom story pronunciations, interjections like "Ahhh", stretched words like "Buzzz-off",
 * and ALL-CAPS dialogue emphasis like "WITCH AND CHIPS" (preventing acronym spell-out).
 *
 * @param {string} rawWord
 * @param {Object<string,string>} [customPronunciations={}]
 * @returns {string}
 */
export function normalizeWordForSpeech(rawWord, customPronunciations = {}) {
    if (!rawWord) return '';
    const trimmed = String(rawWord).trim();
    const cleaned = cleanWordToken(trimmed);
    if (!cleaned) return trimmed;

    if (customPronunciations && customPronunciations[cleaned]) {
        return customPronunciations[cleaned];
    }

    // Handle hyphenated compounds part-by-part (e.g. "Buzzz-off" -> "buzz-off")
    if (cleaned.includes('-')) {
        const rawParts = trimmed.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').split('-');
        return rawParts
            .map((part) => normalizeSinglePartForSpeech(part, customPronunciations))
            .join('-');
    }

    return normalizeSinglePartForSpeech(trimmed, customPronunciations);
}

function normalizeSinglePartForSpeech(rawPart, customPronunciations = {}) {
    const stripped = rawPart
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    if (!stripped) return rawPart;

    const lower = stripped.toLowerCase();
    if (customPronunciations && customPronunciations[lower]) {
        return customPronunciations[lower];
    }

    for (const [pattern, replacement] of INTERJECTION_PATTERNS) {
        if (pattern.test(lower)) {
            return replacement;
        }
    }

    // Collapse any remaining 3+ identical consecutive letters (e.g., "whoooosh" -> "whoosh", "freeeeze" -> "freeze")
    let word = stripped.replace(/(.)\1{2,}/gi, '$1$1');

    // Convert dramatic ALL-CAPS story words (2+ letters, e.g. "AND", "MY", "WITCH") to lowercase
    // so TTS engines do not spell them out letter-by-letter as acronyms.
    const lettersOnly = word.replace(/[^A-Za-z]/g, '');
    if (
        lettersOnly.length >= 2 &&
        word === word.toUpperCase() &&
        !PRESERVED_ACRONYMS.has(lettersOnly)
    ) {
        word = word.toLowerCase();
    }

    return word;
}

/**
 * Waits briefly if the browser hasn't populated speechSynthesis.getVoices() yet on initial load.
 * @param {number} [timeoutMs=250]
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
function getAvailableVoices(timeoutMs = 250) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return Promise.resolve([]);
    }
    const immediate = window.speechSynthesis.getVoices();
    if (immediate && immediate.length > 0) {
        return Promise.resolve(immediate);
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
            resolve(window.speechSynthesis.getVoices() || []);
        };
        const onVoices = () => finish();
        window.speechSynthesis.addEventListener?.('voiceschanged', onVoices);
        setTimeout(finish, timeoutMs);
    });
}

/**
 * Selects the best English voice, honoring user preference first.
 * @param {SpeechSynthesisVoice[]} voices
 * @returns {SpeechSynthesisVoice|null}
 */
export function selectPreferredVoice(voices) {
    if (!voices || voices.length === 0) return null;
    const savedVoiceName = typeof localStorage !== 'undefined' ? localStorage.getItem(VOICE_PREF_KEY) : null;
    if (savedVoiceName) {
        const exact = voices.find((v) => v.name === savedVoiceName);
        if (exact) return exact;
    }

    const englishVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
    if (englishVoices.length === 0) return null;

    return englishVoices
        .slice()
        .sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
}

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
 * @param {HTMLElement|null} [elementToHighlight=null] - Optional element to highlight during single-word speech.
 * @param {Function|null} [onBoundary=null] - Optional callback invoked immediately on word boundaries.
 * @param {number} [rate=1.0] - Base reading speed.
 * @param {object} [options={}]
 * @param {Function} [options.onStart] - Optional callback fired the moment audio playback begins.
 * @param {boolean} [options.isSingleWord] - True when speaking an isolated word tap/flashcard.
 * @param {boolean} [options.cancelExisting=true] - Whether to cancel active speech first.
 */
export async function speakText(textToSpeak, elementToHighlight = null, onBoundary = null, rate = 1.0, options = {}) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !textToSpeak) {
        return;
    }

    const {
        onStart = null,
        isSingleWord = Boolean(elementToHighlight),
        cancelExisting = true
    } = options;

    const synth = window.speechSynthesis;
    const wasBusy = synth.speaking || synth.pending;

    if (cancelExisting && wasBusy) {
        synth.cancel();
    }

    if (currentlySpeakingElement) {
        currentlySpeakingElement.classList.remove('speaking');
    }
    currentlySpeakingElement = elementToHighlight;

    const voices = await getAvailableVoices();

    return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        currentUtterance = utterance;

        const preferredVoice = selectPreferredVoice(voices);
        if (preferredVoice) {
            utterance.voice = preferredVoice;
            utterance.lang = preferredVoice.lang;
        } else {
            utterance.lang = 'en-US';
        }

        if (onBoundary) {
            utterance.onboundary = (event) => {
                if (event.name && event.name !== 'word') return;
                onBoundary(event);
            };
        }

        const lengthFactor = isSingleWord && textToSpeak.length <= 4 ? 0.92 : 1.0;
        utterance.rate = Math.max(0.65, rate * lengthFactor);
        utterance.pitch = isSingleWord && textToSpeak.length <= 4 ? 1.03 : 1.0;
        utterance.volume = 1.0;

        let started = false;
        const triggerStart = () => {
            if (started) return;
            started = true;
            if (currentlySpeakingElement) {
                currentlySpeakingElement.classList.add('speaking');
            }
            if (onStart) {
                onStart({ voice: preferredVoice, utterance });
            }
        };

        utterance.onstart = triggerStart;

        const cleanup = () => {
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

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const speakDelay = wasBusy ? (isIOS ? 110 : 25) : (isIOS ? 35 : 0);

        const dispatchSpeech = () => {
            if (currentUtterance !== utterance) {
                resolve();
                return;
            }
            synth.speak(utterance);
        };

        if (speakDelay > 0) {
            setTimeout(dispatchSpeech, speakDelay);
        } else {
            dispatchSpeech();
        }
    });
}

/**
 * Populates a select element with available English voices, ordered best-first.
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
            const diff = scoreVoice(b) - scoreVoice(a);
            if (diff !== 0) return diff;
            return a.name.localeCompare(b.name);
        });

    let html = `<option value="" ${!savedVoiceName ? 'selected' : ''}>-- Use Best Default --</option>`;
    if (displayVoices.length > 0) {
        html += displayVoices.map((voice) => {
            const isSelected = voice.name === savedVoiceName ? 'selected' : '';
            const safeName = escapeHtml(voice.name);
            const safeLang = escapeHtml(voice.lang);
            const badge = isHighQuality(voice) ? ' ★' : '';
            return `<option value="${safeName}" ${isSelected}>${safeName} (${safeLang})${badge}</option>`;
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
