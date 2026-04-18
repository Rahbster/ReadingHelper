/**
 * GameUI.js
 * Handles all visual rendering for the Word Match game, including the grid,
 * word set management UI, and the victory celebration.
 */

import * as VoiceManager from './VoiceManager.js';

let dom;
let gameManager;
let uiManager;
const GAME_SETS_KEY = 'readingHelperGameWordSets';
let selectedGameSetId = null;
let gameTimerInterval = null;

/**
 * Initializes the GameUI module with required dependencies.
 */
export function init(options) {
    dom = options.dom;
    gameManager = options.gameManager;
    uiManager = options.uiManager;
}

/**
 * Stops the game timer interval.
 */
export function stopTimer() {
    if (gameTimerInterval) {
        clearInterval(gameTimerInterval);
        gameTimerInterval = null;
    }
}

/**
 * Renders the game grid based on the current GameManager state.
 */
export function renderGameGrid() {
    if (!dom || !dom.gameGrid) return;

    dom.gameGrid.style.gridTemplateColumns = `repeat(${gameManager.state.config.gridSize[0]}, 1fr)`;
    dom.gameGrid.innerHTML = gameManager.state.gridWords.map((word, index) => {
        if (!word) return '<div class="flash-card-placeholder"></div>';
        return `
            <div class="flash-card" data-index="${index}" data-word="${word}">
                <div class="card-inner">
                    <div class="card-front">${word}</div>
                    <div class="card-back"><img src="icons/icon-tab.png"></div>
                </div>
            </div>
        `;
    }).join('');
    
    if (dom.gameRemainingCount) {
        const totalRemaining = gameManager.state.wordPool.length + gameManager.state.gridWords.filter(w => w !== null).length;
        dom.gameRemainingCount.textContent = totalRemaining;
    }
}

/**
 * Triggers a random visual reward effect on a correct card.
 * @param {HTMLElement} cardElement 
 */
export function triggerCorrectEffect(cardElement) {
    const effects = ['reward-jump', 'reward-shake', 'reward-glow', 'reward-spin-mini'];
    const effect = effects[Math.floor(Math.random() * effects.length)];
    
    cardElement.classList.add(effect);
    // No need to remove it as the card is about to be re-rendered/flipped anyway
}

/**
 * Handles the visual celebration when a game is completed.
 */
export function startCelebration(score, time, errors) {
    dom.celebScore.textContent = score;
    dom.celebTime.textContent = `${Math.round(time)}s`;
    dom.celebErrors.textContent = errors;
    dom.celebrationModal.classList.remove('hidden');

    const canvas = dom.celebrationCanvas;
    const ctx = canvas.getContext('2d');

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const words = ["Great!", "Awesome!", "Wow!", "Nice!", "Star!", "Reader!", "Super!"];
    const particles = [];

    class WordParticle {
        constructor() { this.reset(); }
        reset() {
            this.x = canvas.width / 2;
            this.y = canvas.height;
            this.word = words[Math.floor(Math.random() * words.length)];
            this.vx = (Math.random() - 0.5) * 10;
            this.vy = -Math.random() * 15 - 10;
            this.gravity = 0.25;
            this.alpha = 1;
            this.rotation = (Math.random() - 0.5) * 0.2;
            this.angle = 0;
            this.color = `hsl(${Math.random() * 360}, 70%, 60%)`;
            this.fontSize = Math.floor(Math.random() * 20) + 24;
            this.isExploded = false;
        }
        update() {
            this.vy += this.gravity;
            this.x += this.vx;
            this.y += this.vy;
            this.angle += this.rotation;
            if (this.vy >= 0 && !this.isExploded) {
                this.isExploded = true;
                for(let i=0; i<5; i++) particles.push(new Spark(this.x, this.y, this.color));
            }
            if (this.y > canvas.height + 50) this.reset();
        }
        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = this.color;
            ctx.font = `bold ${this.fontSize}px 'Segoe UI', sans-serif`;
            ctx.fillText(this.word, 0, 0);
            ctx.restore();
        }
    }

    class Spark {
        constructor(x, y, color) {
            this.x = x; this.y = y; this.color = color;
            this.vx = (Math.random() - 0.5) * 8;
            this.vy = (Math.random() - 0.5) * 8;
            this.alpha = 1;
        }
        update() { this.x += this.vx; this.y += this.vy; this.alpha -= 0.02; }
        draw() {
            ctx.fillStyle = this.color;
            ctx.globalAlpha = this.alpha;
            ctx.beginPath(); ctx.arc(this.x, this.y, 3, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    for (let i = 0; i < 8; i++) particles.push(new WordParticle());

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach((p, i) => {
            p.update(); p.draw();
            if (p instanceof Spark && p.alpha <= 0) particles.splice(i, 1);
        });
        if (!dom.celebrationModal.classList.contains('hidden')) requestAnimationFrame(animate);
    }
    animate();
}

export function getGameWordSets() {
    const sets = localStorage.getItem(GAME_SETS_KEY);
    return sets ? JSON.parse(sets) : [{ id: 'default', name: 'Default Set', words: 'the, and, cat, dog, house, run, jump, blue, red, big, small, fast', lastUsed: 1 }];
}

export function saveGameWordSets(sets) { localStorage.setItem(GAME_SETS_KEY, JSON.stringify(sets)); }

export function renderGameSetEditor() {
    const sets = getGameWordSets();
    dom.gameSetEditorList.innerHTML = sets.map(set => `
        <div class="game-set-editor-item" data-id="${set.id}">
            <input type="text" class="set-name" value="${set.name}" placeholder="Set Name">
            <textarea class="set-words" placeholder="Words...">${set.words}</textarea>
            <div style="display: flex; justify-content: flex-end;"><button class="theme-button destructive delete-set-btn">Delete Set</button></div>
        </div>`).join('');
}

export function addNewGameSet() {
    const sets = getGameWordSets();
    sets.push({ id: `set-${Date.now()}`, name: `New Set ${sets.length + 1}`, words: '', lastUsed: Date.now() });
    saveGameWordSets(sets);
    renderGameSetEditor();
}

export function saveGameSetFromUI(e) {
    const item = e.target.closest('.game-set-editor-item');
    if (!item) return;
    const sets = getGameWordSets();
    const index = sets.findIndex(s => s.id === item.dataset.id);
    if (index > -1) {
        sets[index].name = item.querySelector('.set-name').value;
        sets[index].words = item.querySelector('.set-words').value;
        saveGameWordSets(sets);
    }
}

export function handleGameSetEditorAction(e) {
    if (e.target.classList.contains('delete-set-btn')) {
        const item = e.target.closest('.game-set-editor-item');
        if (confirm('Delete this word set?')) {
            saveGameWordSets(getGameWordSets().filter(s => s.id !== item.dataset.id));
            renderGameSetEditor();
        }
    }
}

export function openGameSetSelector() {
    uiManager.closeNav();
    const sets = getGameWordSets().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    selectedGameSetId = sets[0]?.id;
    dom.gameSetSelectList.innerHTML = sets.map(set => `
        <div class="story-item game-set-item ${set.id === selectedGameSetId ? 'selected' : ''}" data-id="${set.id}">
            <span class="story-item-title">${set.name}</span>
            <span style="font-size: 0.8rem; opacity: 0.7;">${set.words.split(',').length} words</span>
        </div>`).join('');
    dom.gameSetSelectModal.classList.remove('hidden');
}

export function handleGameSetSelection(e) {
    const item = e.target.closest('.game-set-item');
    if (!item) return;
    selectedGameSetId = item.dataset.id;
    dom.gameSetSelectList.querySelectorAll('.game-set-item').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');
}

export function startSelectedGame() {
    const sets = getGameWordSets();
    const set = sets.find(s => s.id === selectedGameSetId);
    if (!set || !set.words.trim()) return alert('Please select a set with words!');
    set.lastUsed = Date.now();
    saveGameWordSets(sets);
    const wordList = set.words.split(',').map(w => w.trim()).filter(w => w);
    dom.gameSetSelectModal.classList.add('hidden');
    uiManager.showView('game');
    gameManager.start({ title: set.name, words: wordList, sampleSize: wordList.length }, { gridSize: [4, 3] });
    renderGameGrid();
    if (gameTimerInterval) clearInterval(gameTimerInterval);
    dom.gameTimer.textContent = '0s';
    gameTimerInterval = setInterval(() => {
        if (gameManager.state.active && dom.gameTimer) {
            dom.gameTimer.textContent = `${Math.floor((Date.now() - gameManager.state.startTime) / 1000)}s`;
        }
    }, 1000);
}