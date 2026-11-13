/**
 * KaraokeMatcher.js
 * Pure phonetic/fuzzy word matching and segment-anchored streaming Speech-to-Text alignment engine.
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
    ['witch', 'which'],
    ['flew', 'flu', 'flue'],
    ['blew', 'blue'],
    ['threw', 'through', 'thru'],
    ['rode', 'road', 'rowed'],
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
    ['pair', 'pear', 'pare'],
    ['tail', 'tale'],
    ['pale', 'pail'],
    ['sail', 'sale'],
    ['wait', 'weight'],
    ['way', 'weigh'],
    ['high', 'hi'],
    ['eye', 'i'],
    ['not', 'knot'],
    ['made', 'maid'],
    ['heard', 'herd'],
    ['grown', 'groan'],
    ['hair', 'hare'],
    ['stair', 'stare'],
    ['steal', 'steel'],
    ['throne', 'thrown'],
    ['weather', 'whether'],
    ['soar', 'sore'],
    ['paws', 'pause'],
    ['claws', 'clause'],
    ['week', 'weak'],
    ['meet', 'meat'],
    ['hole', 'whole'],
    ['peace', 'piece'],
    ['ah', 'ahh', 'ahhh', 'aah'],
    ['oh', 'ohh', 'ohhh', 'ooh']
];

const HOMOPHONE_MAP = new Map();
HOMOPHONE_GROUPS.forEach((group) => {
    group.forEach((w) => HOMOPHONE_MAP.set(w, group));
});

const CONTRACTION_EXPANSIONS = {
    "don't": 'donot',
    "can't": 'cannot',
    "won't": 'willnot',
    "isn't": 'isnot',
    "aren't": 'arenot',
    "wasn't": 'wasnot',
    "weren't": 'werenot',
    "didn't": 'didnot',
    "doesn't": 'doesnot',
    "couldn't": 'couldnot',
    "wouldn't": 'wouldnot',
    "shouldn't": 'shouldnot',
    "haven't": 'havenot',
    "hasn't": 'hasnot',
    "hadn't": 'hadnot',
    "i'm": 'iam',
    "he's": 'heis',
    "she's": 'sheis',
    "it's": 'itis',
    "that's": 'thatis',
    "there's": 'thereis',
    "what's": 'whatis',
    "who's": 'whois',
    "we're": 'weare',
    "they're": 'theyare',
    "you're": 'youare',
    "i'll": 'iwill',
    "we'll": 'wewill',
    "she'll": 'shewill',
    "he'll": 'hewill',
    "they'll": 'theywill',
    "you'll": 'youwill',
    "i've": 'ihave',
    "we've": 'wehave',
    "they've": 'theyhave',
    "you've": 'youhave',
    "i'd": 'iwould',
    "he'd": 'hewould',
    "she'd": 'shewould',
    "they'd": 'theywould',
    "we'd": 'wewould',
    "let's": 'letus'
};

// Short articles/prepositions/fillers that should not trigger single-word jumps on unconfirmed interim ends
const SHORT_FILLERS = new Set([
    'a', 'i', 'an', 'in', 'on', 'at', 'to', 'of', 'it', 'is', 'he', 'we', 'me', 'my',
    'so', 'no', 'go', 'or', 'up', 'by', 'as', 'be', 'do', 'if', 'the', 'and'
]);

const VOCAL_HESITATIONS = new Set(['um', 'umm', 'uh', 'uhh', 'hmm', 'hm', 'er', 'erm']);

function collapseStretchedWord(word) {
    if (!word) return '';
    if (/^no{2,}$/.test(word)) return 'no';
    if (/^so{2,}$/.test(word)) return 'so';
    if (/^go{2,}$/.test(word)) return 'go';
    if (/^ya+y+$/.test(word)) return 'yay';
    return word.replace(/(.)\1{2,}/g, '$1$1');
}

function normalizeTokenForCompare(raw) {
    const cleaned = cleanWordToken(raw);
    if (!cleaned) return '';
    return collapseStretchedWord(NUMBER_WORDS[cleaned] || cleaned);
}

function compactLetters(word) {
    const norm = normalizeTokenForCompare(word);
    if (!norm) return '';
    if (CONTRACTION_EXPANSIONS[norm]) return CONTRACTION_EXPANSIONS[norm];
    return norm.replace(/['-]/g, '');
}

/**
 * Generates a lightweight phonetic signature so homophones and child-like
 * pronunciations match accurately during Speech-to-Text.
 * @param {string} word
 * @returns {string}
 */
export function getPhoneticCode(word) {
    const normalized = normalizeTokenForCompare(word);
    const w = normalized.replace(/[^a-z]/g, '');
    if (!w) return '';
    return w
        .replace(/^kn/, 'n')
        .replace(/^wr/, 'r')
        .replace(/^wh/, 'w')
        .replace(/tch/g, 'ch')
        .replace(/dge/g, 'j')
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
    const rawExpectedClean = cleanWordToken(expectedRaw);
    const normSpoken = normalizeTokenForCompare(spokenRaw);
    const normExpected = normalizeTokenForCompare(expectedRaw);
    if (!normSpoken || !normExpected) return false;
    if (normSpoken === normExpected) return true;

    if (customPronunciations) {
        const customVal = customPronunciations[rawExpectedClean] || customPronunciations[normExpected];
        if (customVal) {
            const cleanCustom = normalizeTokenForCompare(customVal);
            if (cleanCustom === normSpoken || getPhoneticCode(cleanCustom) === getPhoneticCode(normSpoken)) {
                return true;
            }
        }
    }

    if (compactLetters(normSpoken) === compactLetters(normExpected) && compactLetters(normExpected).length >= 3) {
        return true;
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

    if (
        normExpected.length === 4 &&
        normSpoken.length >= 4 &&
        normSpoken[0] === normExpected[0] &&
        editDistance(normSpoken, normExpected) <= 1
    ) {
        return true;
    }

    if (
        normExpected.length >= 7 &&
        normSpoken.length >= 6 &&
        normSpoken[0] === normExpected[0] &&
        editDistance(normSpoken, normExpected) <= 2
    ) {
        return true;
    }

    return false;
}

/**
 * Checks whether TWO consecutive spoken words correspond to ONE story word
 * (e.g. STT "ear splitting" -> "ear-splitting", "buzz off" -> "Buzzz-off", "do not" -> "don't", "in to" -> "into").
 */
function isTwoToOneMatch(spokenA, spokenB, expectedRaw, customPronunciations = {}) {
    const partA = compactLetters(spokenA);
    const partB = compactLetters(spokenB);
    if (!partA || !partB) return false;

    const joined = partA + partB;
    const expectedCompact = compactLetters(expectedRaw);
    if (!expectedCompact || expectedCompact.length < 3) return false;

    if (joined === expectedCompact) return true;

    // Hyphenated story words matched part-by-part (e.g. "Buzzz-off" vs "buzz" + "off")
    const rawExpectedClean = cleanWordToken(expectedRaw);
    if (rawExpectedClean.includes('-')) {
        const expectedParts = rawExpectedClean.split('-').filter(Boolean);
        if (
            expectedParts.length === 2 &&
            isWordsMatch(spokenA, expectedParts[0], customPronunciations) &&
            isWordsMatch(spokenB, expectedParts[1], customPronunciations)
        ) {
            return true;
        }
    }

    if (expectedCompact.length >= 5 && joined[0] === expectedCompact[0] && editDistance(joined, expectedCompact) <= 1) {
        return true;
    }

    return false;
}

/**
 * Checks whether ONE spoken word corresponds to TWO consecutive story words
 * (e.g. STT "don't" -> "do" + "not", "cannot" -> "can" + "not", "into" -> "in" + "to").
 */
function isOneToTwoMatch(spokenRaw, expectedA, expectedB) {
    const spokenCompact = compactLetters(spokenRaw);
    const expectedJoined = compactLetters(expectedA) + compactLetters(expectedB);
    if (!spokenCompact || spokenCompact.length < 3 || !expectedJoined) return false;
    return spokenCompact === expectedJoined;
}

/**
 * Checks if a trailing interim token looks like an unfinished syllable prefix of the expected word
 * (e.g. "mag" while saying "magnificent", or "ear" while saying "ear-splitting").
 */
function isLikelyPartialPrefix(spokenRaw, expectedRaw) {
    const s = compactLetters(spokenRaw);
    const e = compactLetters(expectedRaw);
    if (!s || !e || s.length < 2 || s.length >= e.length) return false;
    if (e.startsWith(s)) return true;
    const ps = getPhoneticCode(s);
    const pe = getPhoneticCode(e);
    return ps.length >= 2 && ps.length < pe.length && pe.startsWith(ps);
}

/**
 * Segment-anchored stateful streaming matcher for Karaoke Mode.
 *
 * Instead of fragile string-prefix slicing (`transcript.startsWith(lastProcessed)`), which chops
 * mid-syllable interim words in half ("the drag" -> "the dragon" => "on") and breaks whenever
 * the browser inserts commas or revises earlier words, each recognizer utterance segment is
 * aligned cleanly as whole words from `anchorPointer` and committed on `final` / segment boundaries.
 */
export class KaraokeSession {
    constructor() {
        this.reset();
    }

    reset() {
        this.readingPointer = 0;
        this.anchorPointer = 0;
        this.activeSegmentIndex = null;
        this.lastInterimWords = [];
        this.segmentConsumedWords = 0;
        this.wordStates = new Map();
        this.recordedTrickyIndices = new Set();
        this.hasCompleted = false;
    }

    onSegmentBoundary() {
        this.anchorPointer = this.readingPointer;
        this.activeSegmentIndex = null;
        this.lastInterimWords = [];
        this.segmentConsumedWords = 0;
    }

    /**
     * Advances pointer when the reader taps a word for help.
     * @param {number} tappedIndex
     */
    recordHelpTap(tappedIndex) {
        if (tappedIndex < 0) return;
        this.wordStates.set(tappedIndex, 'help');
        this.readingPointer = tappedIndex + 1;
        this.anchorPointer = this.readingPointer;
        this.segmentConsumedWords = this.lastInterimWords.length;
    }

    /**
     * Processes an STT result against an array of expected story word strings.
     * @param {object} params
     * @param {string} [params.final='']
     * @param {string} [params.interim='']
     * @param {string|number|null} [params.segmentIndex=null]
     * @param {string[]} [params.storyWords=[]]
     * @param {Object<string,string>} [params.customPronunciations={}]
     * @returns {{ marks: Array<{index:number, status:string}>, clearRange: Array<[number,number]>, readingPointer: number, completed: boolean, trickyWords: string[] }}
     */
    processResult({ final = '', interim = '', segmentIndex = null, storyWords = [], customPronunciations = {} }) {
        const marks = [];
        const clearRange = [];
        const trickyWords = [];

        if (!storyWords || storyWords.length === 0) {
            return { marks, clearRange, readingPointer: this.readingPointer, completed: false, trickyWords };
        }

        const isFinal = Boolean(final);
        const rawTranscript = (final || interim || '').trim();
        if (!rawTranscript) {
            if (isFinal) this.onSegmentBoundary();
            return { marks, clearRange, readingPointer: this.readingPointer, completed: false, trickyWords };
        }

        if (this.readingPointer >= storyWords.length && this.hasCompleted) {
            if (isFinal) this.onSegmentBoundary();
            return { marks, clearRange, readingPointer: this.readingPointer, completed: false, trickyWords };
        }

        // Detect transition to a new Web Speech utterance segment
        if (segmentIndex !== null && this.activeSegmentIndex !== null && segmentIndex !== this.activeSegmentIndex) {
            this.anchorPointer = this.readingPointer;
            this.segmentConsumedWords = 0;
            this.lastInterimWords = [];
        }
        if (segmentIndex !== null) {
            this.activeSegmentIndex = segmentIndex;
        }

        const rawTokens = rawTranscript
            .split(/\s+/)
            .map((t) => cleanWordToken(t))
            .filter(Boolean);

        if (rawTokens.length === 0) {
            if (isFinal) this.onSegmentBoundary();
            return { marks, clearRange, readingPointer: this.readingPointer, completed: false, trickyWords };
        }

        // Fallback implicit-segment detection if caller doesn't pass segmentIndex
        if (
            !isFinal &&
            segmentIndex === null &&
            this.lastInterimWords.length >= 4 &&
            rawTokens.length <= 2 &&
            !isWordsMatch(rawTokens[0], this.lastInterimWords[0], customPronunciations)
        ) {
            this.anchorPointer = this.readingPointer;
            this.segmentConsumedWords = 0;
        }

        const sliceStart = Math.min(this.segmentConsumedWords, rawTokens.length);
        const tokens = rawTokens.slice(sliceStart);
        if (!isFinal) {
            this.lastInterimWords = rawTokens;
        }

        const prevPointer = this.readingPointer;
        const startPtr = Math.min(this.anchorPointer, storyWords.length);
        let ptr = startPtr;
        const segMarks = new Map();

        const setSegMark = (idx, status) => {
            if (this.wordStates.get(idx) === 'help') return;
            segMarks.set(idx, status);
        };

        const matchesAt = (wIdx, sIdx) => {
            if (wIdx >= tokens.length || sIdx >= storyWords.length) return 0;
            if (isWordsMatch(tokens[wIdx], storyWords[sIdx], customPronunciations)) return 1;
            if (
                wIdx + 1 < tokens.length &&
                isTwoToOneMatch(tokens[wIdx], tokens[wIdx + 1], storyWords[sIdx], customPronunciations)
            ) {
                return 2;
            }
            return 0;
        };

        for (let w = 0; w < tokens.length; w++) {
            if (ptr >= storyWords.length) break;

            const spoken = tokens[w];
            if (!spoken) continue;
            const isLastInterimToken = !isFinal && w === tokens.length - 1;

            // 1. Direct 1-to-1 or 2-to-1 match at current pointer
            const directConsumed = matchesAt(w, ptr);
            if (directConsumed > 0) {
                setSegMark(ptr, 'correct');
                ptr += 1;
                w += directConsumed - 1;
                continue;
            }

            // 2. 1-spoken-to-2-story contraction/compound match (e.g. "don't" -> "do not")
            if (ptr + 1 < storyWords.length && isOneToTwoMatch(spoken, storyWords[ptr], storyWords[ptr + 1])) {
                setSegMark(ptr, 'correct');
                setSegMark(ptr + 1, 'correct');
                ptr += 2;
                continue;
            }

            // 3. Hold unfinished partial prefix at the very end of an interim hypothesis
            if (isLastInterimToken && isLikelyPartialPrefix(spoken, storyWords[ptr])) {
                break;
            }

            // 4. Absorb immediate single-word stutter/repeat of the word just read ("the... the cat")
            if (
                ptr > 0 &&
                isWordsMatch(spoken, storyWords[ptr - 1], customPronunciations) &&
                matchesAt(w, ptr + 1) === 0
            ) {
                continue;
            }

            // 5. Forward look-ahead & catch-up window (up to 10 words ahead)
            let jumpedAhead = false;
            const forwardLimit = Math.min(ptr + 10, storyWords.length);
            for (let i = ptr + 1; i < forwardLimit; i++) {
                const consumedHere = matchesAt(w, i);
                if (consumedHere === 0) continue;

                const dist = i - ptr;
                const nextTokenIdx = w + consumedHere;
                const hasNextConfirm =
                    nextTokenIdx < tokens.length &&
                    i + 1 < storyWords.length &&
                    matchesAt(nextTokenIdx, i + 1) > 0;
                const isContentWord = spoken.length >= 3 && !SHORT_FILLERS.has(spoken);

                let allowJump = false;
                if (dist === 1) {
                    allowJump = hasNextConfirm || !isLastInterimToken || isContentWord;
                } else if (dist <= 3) {
                    allowJump =
                        hasNextConfirm ||
                        (spoken.length >= 4 && !SHORT_FILLERS.has(spoken) && (!isLastInterimToken || spoken.length >= 5));
                } else {
                    allowJump = hasNextConfirm || (isFinal && spoken.length >= 7 && !SHORT_FILLERS.has(spoken));
                }

                if (allowJump) {
                    for (let j = ptr; j < i; j++) {
                        setSegMark(j, 'skipped');
                    }
                    setSegMark(i, 'correct');
                    ptr = i + 1;
                    w += consumedHere - 1;
                    jumpedAhead = true;
                    break;
                }
            }
            if (jumpedAhead) continue;

            // 6. Phrase backtracking (2-3 words back when re-reading a phrase)
            let backtracked = false;
            const backLimit = Math.max(startPtr, ptr - 3);
            for (let i = ptr - 2; i >= backLimit; i--) {
                const consumedBack = matchesAt(w, i);
                if (consumedBack === 0) continue;
                const nextTokenIdx = w + consumedBack;
                const hasPhraseConfirm =
                    nextTokenIdx < tokens.length &&
                    i + 1 < storyWords.length &&
                    matchesAt(nextTokenIdx, i + 1) > 0;

                if (hasPhraseConfirm) {
                    setSegMark(i, 'correct');
                    for (let k = i + 1; k < ptr; k++) {
                        segMarks.delete(k);
                    }
                    ptr = i + 1;
                    w += consumedBack - 1;
                    backtracked = true;
                    break;
                }
            }
            if (backtracked) continue;

            // 7. Unmatched word at current pointer: ignore pure vocal hesitations ("um", "uh")
            // and hold trailing short fillers on interim updates
            if (VOCAL_HESITATIONS.has(spoken)) {
                continue;
            }
            if (isLastInterimToken && SHORT_FILLERS.has(spoken)) {
                break;
            }

            if (!segMarks.has(ptr)) {
                setSegMark(ptr, 'misspoken');
            }
        }

        // Clear any tentative marks from a previous interim hypothesis that retracted
        const maxPreviousTouch = Math.max(prevPointer, prevPointer + 1);
        const clearStart = Math.min(ptr, prevPointer);
        if (clearStart < maxPreviousTouch) {
            for (let idx = startPtr; idx <= maxPreviousTouch; idx++) {
                if (idx >= storyWords.length) break;
                if (!segMarks.has(idx) && this.wordStates.has(idx) && this.wordStates.get(idx) !== 'help') {
                    this.wordStates.delete(idx);
                    clearRange.push([idx, idx + 1]);
                }
            }
        }

        // Emit marks that changed or updated
        for (const [idx, status] of segMarks.entries()) {
            if (this.wordStates.get(idx) !== status) {
                this.wordStates.set(idx, status);
                marks.push({ index: idx, status });
            } else if (isFinal) {
                marks.push({ index: idx, status });
            }

            // Record tricky words when confirmed (skipped words that we've moved past, or final misspoken)
            if ((status === 'skipped' && (isFinal || ptr > idx + 1)) || (status === 'misspoken' && isFinal)) {
                if (!this.recordedTrickyIndices.has(idx)) {
                    this.recordedTrickyIndices.add(idx);
                    const cleanExpected = cleanWordToken(storyWords[idx]);
                    if (cleanExpected.length > 2) {
                        trickyWords.push(cleanExpected);
                    }
                }
            }
        }

        this.readingPointer = ptr;

        if (isFinal) {
            this.onSegmentBoundary();
        }

        let completed = false;
        if (!this.hasCompleted && this.readingPointer >= storyWords.length && storyWords.length > 0) {
            this.hasCompleted = true;
            completed = true;
        }

        return {
            marks,
            clearRange,
            readingPointer: this.readingPointer,
            completed,
            trickyWords
        };
    }
}
