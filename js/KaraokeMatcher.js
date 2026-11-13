/**
 * KaraokeMatcher.js
 * Pure phonetic/fuzzy word matching and sequential Speech-to-Text alignment engine.
 */

import { cleanWordToken } from './utils/dom-utils.js';

export const NUMBER_WORDS = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
    '10': 'ten', '11': 'eleven', '12': 'twelve'
};

export const HOMOPHONE_GROUPS = [
    ['to', 'too', 'two', '2'],
    ['there', 'their', "they're", 'theyre'],
    ['your', "you're", 'youre'],
    ['its', "it's"],
    ['for', 'four', 'fore', '4'],
    ['one', 'won', '1'],
    ['eight', 'ate', '8'],
    ['be', 'bee'],
    ['see', 'sea'],
    ['hear', 'here'],
    ['no', 'know'],
    ['knew', 'new'],
    ['knight', 'night'],
    ['right', 'write'],
    ['read', 'red'],
    ['wear', 'where'],
    ['by', 'buy', 'bye'],
    ['hour', 'our'],
    ['son', 'sun'],
    ['wood', 'would'],
    ['flower', 'flour'],
    ['bear', 'bare'],
    ['pair', 'pear'],
    ['tail', 'tale'],
    ['week', 'weak'],
    ['meet', 'meat'],
    ['hole', 'whole'],
    ['peace', 'piece']
];

const HOMOPHONE_MAP = new Map();
HOMOPHONE_GROUPS.forEach((group) => {
    group.forEach((w) => HOMOPHONE_MAP.set(w, group));
});

/**
 * Generates a lightweight phonetic signature so homophones and child-like
 * pronunciations match accurately during Speech-to-Text.
 * @param {string} word
 * @returns {string}
 */
export function getPhoneticCode(word) {
    const normalized = cleanWordToken(word);
    const w = (NUMBER_WORDS[normalized] || normalized).replace(/[^a-z]/g, '');
    if (!w) return '';
    return w
        .replace(/^kn/, 'n')
        .replace(/^wr/, 'r')
        .replace(/^wh/, 'w')
        .replace(/ph/g, 'f')
        .replace(/ght/g, 't')
        .replace(/ck/g, 'k')
        .replace(/([a-z])\1+/g, '$1')
        .replace(/^(.{3,})e$/, '$1');
}

/**
 * Computes Levenshtein edit distance between two short strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
    if (a === b) return 0;
    const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[a.length][b.length];
}

/**
 * Determines whether a spoken word matches an expected story word using
 * exact match, custom story pronunciations, homophones, or phonetic/edit similarity.
 * @param {string} spokenRaw
 * @param {string} expectedRaw
 * @param {Object<string,string>} [customPronunciations={}]
 * @returns {boolean}
 */
export function isWordsMatch(spokenRaw, expectedRaw, customPronunciations = {}) {
    const spoken = cleanWordToken(spokenRaw);
    const expected = cleanWordToken(expectedRaw);
    if (!spoken || !expected) return false;
    if (spoken === expected) return true;

    const normSpoken = NUMBER_WORDS[spoken] || spoken;
    const normExpected = NUMBER_WORDS[expected] || expected;
    if (normSpoken === normExpected) return true;

    if (customPronunciations && customPronunciations[expected]) {
        if (cleanWordToken(customPronunciations[expected]) === spoken) {
            return true;
        }
    }

    const homophones = HOMOPHONE_MAP.get(normExpected);
    if (homophones && homophones.includes(normSpoken)) {
        return true;
    }

    const pSpoken = getPhoneticCode(normSpoken);
    const pExpected = getPhoneticCode(normExpected);
    if (pSpoken.length >= 3 && pSpoken === pExpected) {
        return true;
    }

    if (normExpected.length >= 5 && normSpoken.length >= 4 && editDistance(normSpoken, normExpected) <= 1) {
        return true;
    }

    return false;
}

/**
 * Stateful sequential matcher for Karaoke Mode.
 */
export class KaraokeSession {
    constructor() {
        this.readingPointer = 0;
        this.lastProcessedTranscript = '';
    }

    reset() {
        this.readingPointer = 0;
        this.lastProcessedTranscript = '';
    }

    onSegmentBoundary() {
        this.lastProcessedTranscript = '';
    }

    /**
     * Advances pointer when the reader taps a word for help.
     * @param {number} tappedIndex
     */
    recordHelpTap(tappedIndex) {
        if (tappedIndex < 0) return;
        this.readingPointer = tappedIndex + 1;
    }

    /**
     * Processes an STT result against an array of expected story word strings.
     * @param {object} params
     * @param {string} params.final
     * @param {string} params.interim
     * @param {string[]} params.storyWords
     * @param {Object<string,string>} [params.customPronunciations={}]
     * @returns {{ marks: Array<{index:number, status:string}>, clearRange: Array<[number,number]>, readingPointer: number, completed: boolean, trickyWords: string[] }}
     */
    processResult({ final = '', interim = '', storyWords = [], customPronunciations = {} }) {
        const transcript = (final || interim).toLowerCase();
        const marks = [];
        const clearRange = [];
        const trickyWords = [];

        if (!transcript || this.readingPointer >= storyWords.length) {
            return { marks, clearRange, readingPointer: this.readingPointer, completed: false, trickyWords };
        }

        let newPart = transcript;
        if (this.lastProcessedTranscript && transcript.startsWith(this.lastProcessedTranscript)) {
            newPart = transcript.substring(this.lastProcessedTranscript.length).trim();
        }

        if (final) {
            this.lastProcessedTranscript = '';
        } else {
            this.lastProcessedTranscript = transcript;
        }

        if (!newPart) {
            return { marks, clearRange, readingPointer: this.readingPointer, completed: false, trickyWords };
        }

        const spokenWords = newPart.split(/\s+/);

        for (const spoken of spokenWords) {
            if (this.readingPointer >= storyWords.length) break;
            const cleanedSpoken = cleanWordToken(spoken);
            if (!cleanedSpoken) continue;

            // 1. Exact/fuzzy match on current target word
            const currentExpected = storyWords[this.readingPointer];
            if (isWordsMatch(cleanedSpoken, currentExpected, customPronunciations)) {
                marks.push({ index: this.readingPointer, status: 'correct' });
                this.readingPointer++;
                continue;
            }

            // 2. Backtracking window (up to 3 words back for natural self-correction)
            let backtracked = false;
            const backLimit = Math.max(0, this.readingPointer - 3);
            for (let i = this.readingPointer - 1; i >= backLimit; i--) {
                if (isWordsMatch(cleanedSpoken, storyWords[i], customPronunciations)) {
                    marks.push({ index: i, status: 'correct' });
                    if (i + 1 < this.readingPointer) {
                        clearRange.push([i + 1, this.readingPointer]);
                    }
                    this.readingPointer = i + 1;
                    backtracked = true;
                    break;
                }
            }
            if (backtracked) continue;

            // 3. Look-ahead window (up to 5 words ahead when skipping tricky words)
            let skippedAhead = false;
            const forwardLimit = Math.min(this.readingPointer + 5, storyWords.length);
            for (let i = this.readingPointer + 1; i < forwardLimit; i++) {
                if (isWordsMatch(cleanedSpoken, storyWords[i], customPronunciations)) {
                    for (let j = this.readingPointer; j < i; j++) {
                        marks.push({ index: j, status: 'skipped' });
                        const skippedClean = cleanWordToken(storyWords[j]);
                        if (skippedClean.length > 2) trickyWords.push(skippedClean);
                    }
                    marks.push({ index: i, status: 'correct' });
                    this.readingPointer = i + 1;
                    skippedAhead = true;
                    break;
                }
            }
            if (skippedAhead) continue;

            // 4. Misspoken attempt at current pointer
            marks.push({ index: this.readingPointer, status: 'misspoken' });
            if (final) {
                const misspokenClean = cleanWordToken(currentExpected);
                if (misspokenClean.length > 2) trickyWords.push(misspokenClean);
            }
        }

        const completed = Boolean(final && this.readingPointer >= storyWords.length && storyWords.length > 0);
        return {
            marks,
            clearRange,
            readingPointer: this.readingPointer,
            completed,
            trickyWords
        };
    }
}
