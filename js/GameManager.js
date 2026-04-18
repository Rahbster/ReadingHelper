export class GameManager {
    constructor(options) {
        this.toastManager = options.toastManager;
        this.speakFn = options.speakFn;
        this.onGameOver = options.onGameOver;
        
        this.state = {
            active: false,
            wordPool: [],
            gridWords: [],
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

    start(wordSet, config) {
        const allWords = wordSet.words || [];
        const count = wordSet.sampleSize || allWords.length;
        
        this.state.wordPool = this._shuffle([...allWords]).slice(0, count);
        this.state.active = true;
        this.state.startTime = Date.now();
        this.state.errors = 0;
        this.state.config = { ...this.state.config, ...config };

        // Fill initial grid
        const initialSize = this.state.config.gridSize[0] * this.state.config.gridSize[1];
        this.state.gridWords = this.state.wordPool.splice(0, initialSize);
        
        this.pickNextTarget();
        this.speakFn(this.state.targetWord);
    }

    pickNextTarget() {
        if (this.state.gridWords.filter(w => w !== null).length === 0) {
            this.endGame();
            return;
        }
        
        const available = this.state.gridWords.filter(w => w !== null);
        this.state.targetWord = available[Math.floor(Math.random() * available.length)];
    }

    handleChoice(word, index) {
        if (!this.state.active) return false;

        if (word === this.state.targetWord) {
            // Correct
            const nextFromPool = this.state.wordPool.length > 0 ? this.state.wordPool.shift() : null;
            this.state.gridWords[index] = nextFromPool;
            this.pickNextTarget();
            return true;
        } else {
            // Wrong
            this.state.errors++;
            this.toastManager.show("Try again!", "error", 1000);
            this.speakFn(this.state.targetWord);
            return false;
        }
    }

    endGame() {
        this.state.active = false;
        const timeTaken = (Date.now() - this.state.startTime) / 1000;
        const score = this.calculateScore(timeTaken);
        this.onGameOver(score, timeTaken, this.state.errors);
    }

    calculateScore(timeSeconds) {
        const { threshold, penalty, wrongPenalty } = this.state.config;
        const wordCount = (this.state.config.gridSize[0] * this.state.config.gridSize[1]) + this.state.wordPool.length;
        
        const perfectionBasis = wordCount * threshold;
        let finalScore = perfectionBasis * 10; // Scale it up

        // Time penalty
        if (timeSeconds > perfectionBasis) {
            finalScore -= (timeSeconds - perfectionBasis) * penalty;
        }

        // Error penalty
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