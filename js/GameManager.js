/**
 * GameManager.js
 * Pure logic class managing Word Match state, minimal-pair distractor grouping,
 * mastered word tracking, and scoring.
 */

export const MINIMAL_PAIR_GROUPS = [
    ['tree', 'three', 'free'],
    ['was', 'saw'],
    ['on', 'no'],
    ['for', 'from', 'four'],
    ['there', 'where', 'here', 'were'],
    ['went', 'want'],
    ['then', 'than', 'them'],
    ['big', 'pig', 'dig'],
    ['cat', 'hat', 'bat', 'mat'],
    ['house', 'mouse'],
    ['look', 'book', 'took'],
    ['chip', 'ship'],
    ['thin', 'chin', 'shin'],
    ['bear', 'pear', 'wear'],
    ['through', 'though', 'thought'],
    ['quiet', 'quite'],
    ['stop', 'spot'],
    ['felt', 'left'],
    ['who', 'how'],
    ['now', 'own'],
    ['bed', 'bad']
];

const MINIMAL_PAIR_MAP = new Map();
MINIMAL_PAIR_GROUPS.forEach((group) => {
    group.forEach((w) => MINIMAL_PAIR_MAP.set(w, group));
});

/**
 * Returns minimal-pair partners for a given word (excluding itself).
 * @param {string} word
 * @returns {string[]}
 */
export function getMinimalPairPartners(word) {
    if (!word) return [];
    const lower = word.toLowerCase().trim();
    const group = MINIMAL_PAIR_MAP.get(lower);
    return group ? group.filter((w) => w !== lower) : [];
}

export class GameManager {
    constructor(options = {}) {
        this.toastManager = options.toastManager;
        this.speakFn = options.speakFn || (() => {});
        this.onGameOver = options.onGameOver || (() => {});
        this.onCorrect = options.onCorrect || (() => {});
        this.onWrong = options.onWrong || (() => {});

        this.state = {
            active: false,
            wordPool: [],
            gridWords: [],
            masteredWords: [],
            totalWords: 0,
            targetWord: null,
            startTime: 0,
            errors: 0,
            config: {
                gridSize: [4, 3],
                threshold: 5,
                penalty: 2,
                wrongPenalty: 10
            }
        };
    }

    start(wordSet, config = {}) {
        const rawWords = Array.isArray(wordSet.words) ? wordSet.words : [];
        const uniqueWords = [...new Set(rawWords.map((w) => String(w).trim()).filter(Boolean))];
        const count = Math.min(wordSet.sampleSize || uniqueWords.length, uniqueWords.length);

        const selected = this._selectWithMinimalPairs(uniqueWords, count);

        this.state.wordPool = selected;
        this.state.totalWords = this.state.wordPool.length;
        this.state.masteredWords = [];
        this.state.active = true;
        this.state.startTime = Date.now();
        this.state.errors = 0;
        this.state.config = { ...this.state.config, ...config };

        const initialSize = this.state.config.gridSize[0] * this.state.config.gridSize[1];
        this.state.gridWords = this._shuffle(this.state.wordPool.splice(0, initialSize));

        this.pickNextTarget();
        if (this.state.targetWord) {
            this.speakFn(this.state.targetWord);
        }
    }

    stop() {
        this.state.active = false;
    }

    /**
     * Selects up to `count` words while keeping minimal pairs grouped near each other
     * so similar-looking/similar-sounding words appear on the board together.
     */
    _selectWithMinimalPairs(words, count) {
        const shuffled = this._shuffle([...words]);
        const lowerToOriginal = new Map();
        shuffled.forEach((w) => lowerToOriginal.set(w.toLowerCase(), w));

        const chosen = [];
        const usedLower = new Set();

        for (const w of shuffled) {
            if (chosen.length >= count) break;
            const lower = w.toLowerCase();
            if (usedLower.has(lower)) continue;

            chosen.push(w);
            usedLower.add(lower);

            const partners = getMinimalPairPartners(lower);
            for (const partnerLower of partners) {
                if (chosen.length >= count) break;
                if (!usedLower.has(partnerLower) && lowerToOriginal.has(partnerLower)) {
                    chosen.push(lowerToOriginal.get(partnerLower));
                    usedLower.add(partnerLower);
                }
            }
        }

        return chosen;
    }

    /**
     * Pulls the next replacement word from `wordPool`, preferring a minimal-pair partner
     * of a word already visible on the grid when available.
     */
    _drawNextPoolWord() {
        if (this.state.wordPool.length === 0) return null;

        const activeGridSet = new Set(
            this.state.gridWords.filter(Boolean).map((w) => w.toLowerCase())
        );

        const partnerIdx = this.state.wordPool.findIndex((candidate) => {
            const partners = getMinimalPairPartners(candidate);
            return partners.some((p) => activeGridSet.has(p));
        });

        if (partnerIdx > -1) {
            return this.state.wordPool.splice(partnerIdx, 1)[0];
        }
        return this.state.wordPool.shift();
    }

    pickNextTarget() {
        const available = this.state.gridWords.filter((w) => w !== null);
        if (available.length === 0) {
            this.endGame();
            return;
        }

        // Slightly favor words on the grid that currently have a minimal-pair distractor visible
        const availableLower = new Set(available.map((w) => w.toLowerCase()));
        const pairedCandidates = available.filter((w) =>
            getMinimalPairPartners(w).some((p) => availableLower.has(p))
        );

        const poolToPick = pairedCandidates.length > 0 && Math.random() < 0.7
            ? pairedCandidates
            : available;

        this.state.targetWord = poolToPick[Math.floor(Math.random() * poolToPick.length)];
    }

    handleChoice(word, index) {
        if (!this.state.active) return false;

        if (word === this.state.targetWord) {
            this.state.masteredWords.push(word);
            this.onCorrect(word, index);
            const nextFromPool = this._drawNextPoolWord();
            this.state.gridWords[index] = nextFromPool;
            this.pickNextTarget();
            return true;
        } else {
            this.state.errors++;
            this.onWrong(word, index);
            if (this.toastManager) {
                this.toastManager.show('Try again!', 'error', 1000);
            }
            this.speakFn(this.state.targetWord);
            return false;
        }
    }

    endGame() {
        this.state.active = false;
        const timeTaken = (Date.now() - this.state.startTime) / 1000;
        const score = this.calculateScore(timeTaken);
        this.onGameOver(score, timeTaken, this.state.errors, [...this.state.masteredWords]);
    }

    calculateScore(timeSeconds) {
        const { threshold, penalty, wrongPenalty } = this.state.config;
        const wordCount = this.state.totalWords || (this.state.config.gridSize[0] * this.state.config.gridSize[1]);

        const perfectionBasis = wordCount * threshold;
        let finalScore = perfectionBasis * 10;

        if (timeSeconds > perfectionBasis) {
            finalScore -= (timeSeconds - perfectionBasis) * penalty;
        }

        finalScore -= this.state.errors * wrongPenalty;

        return Math.max(0, Math.round(finalScore));
    }

    _shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}
