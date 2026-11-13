/**
 * GameUI.js
 * Handles all visual rendering for the Word Match game, including the grid,
 * word set management UI, Tricky Words practice mode, and the victory celebration.
 */

import * as storyManager from '../story-manager.js';
import {
    escapeHtml,
    openDialog,
    closeDialog,
    showConfirmModal,
    prefersReducedMotion,
    requireParentGate
} from './utils/dom-utils.js';
import { playCelebrationSound } from './sound-effects.js';

let dom;
let gameManager;
let uiManager;
let toastManager;
let getWordStatsFn = () => ({});

const GAME_SETS_KEY = 'readingHelperGameWordSets';
const DEFAULT_WORD_SETS = [
    {
        id: 'default',
        name: 'Sight Words Starter',
        words: 'the, and, cat, dog, house, run, jump, blue, red, big, small, fast',
        lastUsed: 2
    },
    {
        id: 'tricky-pairs',
        name: 'Tricky Pairs (Look & Listen)',
        words: 'tree, three, was, saw, where, there, went, want, chip, ship, house, mouse, look, book, quiet, quite, stop, spot, felt, left',
        lastUsed: 1
    }
];

let selectedGameSetId = null;
let selectedItemType = 'set'; // 'set', 'tricky', 'story', or 'default-story'
let currentGameImages = [];
let gameTimerInterval = null;
let celebrationRafId = null;

export function getLevelBadgeHtml(level) {
    const num = Number(level);
    if (num === 1) return '<span class="level-badge level-1" title="Beginner">Level 1 🌱</span>';
    if (num === 2) return '<span class="level-badge level-2" title="Growing Reader">Level 2 🌿</span>';
    if (num === 3) return '<span class="level-badge level-3" title="Confident Reader">Level 3 🌳</span>';
    return '';
}

/**
 * Initializes the GameUI module with required dependencies.
 */
export function init(options) {
    dom = options.dom;
    gameManager = options.gameManager;
    uiManager = options.uiManager;
    toastManager = options.toastManager;
    if (options.getWordStats) getWordStatsFn = options.getWordStats;
}

/**
 * Stops the game timer interval and any active celebration animation.
 */
export function stopTimer() {
    if (gameTimerInterval) {
        clearInterval(gameTimerInterval);
        gameTimerInterval = null;
    }
}

export function stopCelebration() {
    if (celebrationRafId !== null) {
        cancelAnimationFrame(celebrationRafId);
        celebrationRafId = null;
    }
    if (dom && dom.celebrationModal) {
        closeDialog(dom.celebrationModal);
    }
}

export function exitGame() {
    gameManager.stop();
    stopTimer();
    stopCelebration();
    uiManager.showView('reader');
}

/**
 * Renders the game grid based on the current GameManager state using accessible <button> cards.
 */
export function renderGameGrid() {
    if (!dom || !dom.gameGrid) return;

    const [cols, rows] = gameManager.state.config.gridSize;
    dom.gameGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    dom.gameGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    dom.gameGrid.innerHTML = gameManager.state.gridWords.map((word, index) => {
        if (!word) return '<div class="flash-card-placeholder" aria-hidden="true"></div>';
        const safeWord = escapeHtml(word);
        return `
            <button type="button" class="flash-card" data-index="${index}" data-word="${safeWord}" aria-label="Word card: ${safeWord}">
                <span class="card-front">${safeWord}</span>
                <span class="card-back" aria-hidden="true"><img src="icons/reading-icon.svg" alt=""></span>
            </button>
        `;
    }).join('');

    if (dom.gameRemainingCount) {
        const totalRemaining = gameManager.state.wordPool.length + gameManager.state.gridWords.filter((w) => w !== null).length;
        dom.gameRemainingCount.textContent = totalRemaining;
    }
}

/**
 * Triggers a random visual reward effect on a correct card.
 * @param {HTMLElement} cardElement
 */
export function triggerCorrectEffect(cardElement) {
    if (prefersReducedMotion()) return;
    const effects = ['reward-jump', 'reward-shake', 'reward-glow', 'reward-spin-mini'];
    const effect = effects[Math.floor(Math.random() * effects.length)];
    cardElement.classList.add(effect);
}

/**
 * Handles the visual celebration when a game is completed, launching fireworks
 * with the actual words the child just mastered.
 */
export function startCelebration(score, time, errors, masteredWords = []) {
    stopCelebration();

    dom.celebScore.textContent = score;
    dom.celebTime.textContent = `${Math.round(time)}s`;
    dom.celebErrors.textContent = errors;
    openDialog(dom.celebrationModal);
    playCelebrationSound();

    const canvas = dom.celebrationCanvas;
    if (!canvas || prefersReducedMotion()) {
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
    }

    const ctx = canvas.getContext('2d');
    const syncCanvasSize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    syncCanvasSize();

    const imageElements = currentGameImages.map((src) => {
        const img = new Image();
        img.src = src;
        return img;
    });

    const uniqueMastered = [...new Set((masteredWords || []).filter(Boolean))];
    const words = uniqueMastered.length > 0
        ? uniqueMastered
        : ['Great!', 'Awesome!', 'Wow!', 'Nice!', 'Star!', 'Reader!', 'Super!'];

    const particles = [];

    class WordParticle {
        constructor() { this.reset(); }
        reset() {
            this.x = canvas.width / 2 + (Math.random() - 0.5) * (canvas.width * 0.3);
            this.y = canvas.height;
            this.word = words[Math.floor(Math.random() * words.length)];
            this.vx = (Math.random() - 0.5) * 9;
            this.vy = -Math.random() * 14 - 10;
            this.gravity = 0.24;
            this.rotation = (Math.random() - 0.5) * 0.16;
            this.angle = 0;
            this.color = `hsl(${Math.random() * 360}, 75%, 55%)`;
            this.fontSize = Math.floor(Math.random() * 18) + 26;
            this.isExploded = false;
        }
        update() {
            this.vy += this.gravity;
            this.x += this.vx;
            this.y += this.vy;
            this.angle += this.rotation;
            if (this.vy >= 0 && !this.isExploded) {
                this.isExploded = true;
                for (let i = 0; i < 6; i++) particles.push(new Spark(this.x, this.y, this.color));
            }
            if (this.y > canvas.height + 60) this.reset();
        }
        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = this.color;
            ctx.font = `bold ${this.fontSize}px 'Comic Neue', cursive, sans-serif`;
            ctx.fillText(this.word, 0, 0);
            ctx.restore();
        }
    }

    class ImageParticle {
        constructor() { this.reset(); }
        reset() {
            this.img = imageElements[Math.floor(Math.random() * imageElements.length)];
            this.x = Math.random() * canvas.width;
            this.y = canvas.height + 100;
            this.vx = (Math.random() - 0.5) * 5;
            this.vy = -Math.random() * 12 - 8;
            this.gravity = 0.15;
            this.rotation = (Math.random() - 0.5) * 0.1;
            this.angle = 0;
            this.size = 100 + Math.random() * 80;
        }
        update() {
            this.vy += this.gravity;
            this.x += this.vx;
            this.y += this.vy;
            this.angle += this.rotation;
            if (this.y > canvas.height + 150 && this.vy > 0) this.reset();
        }
        draw() {
            if (!this.img || !this.img.complete) return;
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.drawImage(this.img, -this.size / 2, -this.size / 2, this.size, this.size);
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
        update() { this.x += this.vx; this.y += this.vy; this.alpha -= 0.025; }
        draw() {
            ctx.fillStyle = this.color;
            ctx.globalAlpha = Math.max(0, this.alpha);
            ctx.beginPath();
            ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    for (let i = 0; i < 8; i++) particles.push(new WordParticle());
    if (imageElements.length > 0) {
        for (let i = 0; i < 4; i++) particles.push(new ImageParticle());
    }

    function animate() {
        if (dom.celebrationModal.classList.contains('hidden')) {
            celebrationRafId = null;
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.update();
            p.draw();
            if (p instanceof Spark && p.alpha <= 0) {
                particles.splice(i, 1);
            }
        }
        celebrationRafId = requestAnimationFrame(animate);
    }
    celebrationRafId = requestAnimationFrame(animate);
}

export function getGameWordSets() {
    const setsJson = localStorage.getItem(GAME_SETS_KEY);
    if (!setsJson) return DEFAULT_WORD_SETS.map((s) => ({ ...s }));
    try {
        const parsed = JSON.parse(setsJson);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return DEFAULT_WORD_SETS.map((s) => ({ ...s }));
        }
        // Upgrade existing single-default installs by adding Tricky Pairs if not yet present
        if (parsed.length === 1 && parsed[0].id === 'default') {
            parsed.push({ ...DEFAULT_WORD_SETS[1] });
        }
        return parsed;
    } catch (e) {
        return DEFAULT_WORD_SETS.map((s) => ({ ...s }));
    }
}

export function saveGameWordSets(sets) {
    localStorage.setItem(GAME_SETS_KEY, JSON.stringify(sets));
}

export function renderGameSetEditor() {
    if (!dom || !dom.gameSetEditorList) return;
    const sets = getGameWordSets();
    dom.gameSetEditorList.innerHTML = sets.map((set) => `
        <div class="game-set-editor-item" data-id="${escapeHtml(set.id)}">
            <input type="text" class="set-name" value="${escapeHtml(set.name)}" placeholder="Set Name" aria-label="Word Set Name">
            <textarea class="set-words" placeholder="Comma-separated words (e.g. tree, three, house)..." aria-label="Words in set">${escapeHtml(set.words)}</textarea>
            <div style="display: flex; justify-content: flex-end;"><button type="button" class="theme-button destructive delete-set-btn">Delete Set</button></div>
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
    const index = sets.findIndex((s) => s.id === item.dataset.id);
    if (index > -1) {
        sets[index].name = item.querySelector('.set-name').value;
        sets[index].words = item.querySelector('.set-words').value;
        saveGameWordSets(sets);
    }
}

export async function handleGameSetEditorAction(e) {
    if (e.target.classList.contains('delete-set-btn')) {
        const item = e.target.closest('.game-set-editor-item');
        if (!item) return;
        const confirmed = await showConfirmModal({
            title: 'Delete Word Set?',
            message: 'Are you sure you want to delete this word set?',
            confirmText: 'Delete',
            destructive: true
        });
        if (confirmed) {
            saveGameWordSets(getGameWordSets().filter((s) => s.id !== item.dataset.id));
            renderGameSetEditor();
        }
    }
}

function getTopTrickyWords(limit = 24) {
    const stats = getWordStatsFn() || {};
    return Object.entries(stats)
        .filter(([w]) => w && w.length >= 2)
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([w]) => w);
}

/**
 * Launches a Word Match game directly from the child's tracked Tricky Words.
 */
export async function startTrickyWordsGame() {
    const trickyWords = getTopTrickyWords(24);
    if (trickyWords.length < 4) {
        if (toastManager) {
            toastManager.show('Tap at least 4 tricky words while reading a story first!', 'info');
        }
        return;
    }
    selectedItemType = 'tricky';
    selectedGameSetId = '__tricky__';
    await startSelectedGame();
}

export async function openGameSetSelector() {
    uiManager.closeNav();
    const sets = getGameWordSets().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    const trickyWords = getTopTrickyWords(24);

    const userStories = storyManager.getUserStories();
    let defaultStories = [];
    try {
        const res = await fetch('stories.json');
        if (res.ok) defaultStories = await res.json();
    } catch (e) {}

    if (!selectedGameSetId) {
        if (trickyWords.length >= 4) {
            selectedGameSetId = '__tricky__';
            selectedItemType = 'tricky';
        } else if (sets[0]) {
            selectedGameSetId = sets[0].id;
            selectedItemType = 'set';
        }
    }

    let html = '';

    // Dynamic Tricky Words practice set
    if (trickyWords.length >= 4) {
        const isSelected = selectedItemType === 'tricky' ? 'selected' : '';
        html += '<div class="story-group-header">Personalized Practice</div>';
        html += `
            <button type="button" class="story-item game-set-item ${isSelected}" data-id="__tricky__" data-type="tricky">
                <span class="story-item-title">🎯 My Tricky Words</span>
                <span class="item-meta-label">${trickyWords.length} words</span>
            </button>`;
    }

    // Word Sets
    if (sets.length > 0) {
        html += `<div class="story-group-header" style="${trickyWords.length >= 4 ? 'margin-top: 15px;' : ''}">Word Sets</div>`;
        html += sets.map((set) => {
            const count = set.words.split(',').map((w) => w.trim()).filter(Boolean).length;
            const isSelected = set.id === selectedGameSetId && selectedItemType === 'set' ? 'selected' : '';
            return `
                <button type="button" class="story-item game-set-item ${isSelected}" data-id="${escapeHtml(set.id)}" data-type="set">
                    <span class="story-item-title">${escapeHtml(set.name)}</span>
                    <span class="item-meta-label">${count} words</span>
                </button>`;
        }).join('');
    }

    // Stories
    if (userStories.length > 0 || defaultStories.length > 0) {
        html += '<div class="story-group-header" style="margin-top: 15px;">Stories</div>';
        html += userStories.map((story) => {
            const isSelected = story.id === selectedGameSetId && selectedItemType === 'story' ? 'selected' : '';
            return `
                <button type="button" class="story-item game-set-item ${isSelected}" data-id="${escapeHtml(story.id)}" data-type="story">
                    <span class="story-item-title">${escapeHtml(story.title)}</span>
                    <span class="item-meta-label">My Story</span>
                </button>`;
        }).join('');

        html += defaultStories.map((story) => {
            const isSelected = story.path === selectedGameSetId && selectedItemType === 'default-story' ? 'selected' : '';
            return `
                <button type="button" class="story-item game-set-item ${isSelected}" data-id="${escapeHtml(story.path)}" data-type="default-story">
                    <span class="story-item-title">${escapeHtml(story.title)}</span>
                    ${getLevelBadgeHtml(story.level)}
                </button>`;
        }).join('');
    }

    dom.gameSetSelectList.innerHTML = html;
    openDialog(dom.gameSetSelectModal);
}

export function handleGameSetSelection(e) {
    const item = e.target.closest('.game-set-item');
    if (!item) return;
    selectedGameSetId = item.dataset.id;
    selectedItemType = item.dataset.type;
    dom.gameSetSelectList.querySelectorAll('.game-set-item').forEach((el) => el.classList.remove('selected'));
    item.classList.add('selected');
}

export async function startSelectedGame() {
    let wordList = [];
    let title = '';
    currentGameImages = [];

    if (selectedItemType === 'tricky') {
        wordList = getTopTrickyWords(24);
        if (wordList.length < 4) {
            if (toastManager) toastManager.show('Need at least 4 tricky words to start!', 'info');
            return;
        }
        title = 'My Tricky Words';
    } else if (selectedItemType === 'set') {
        const sets = getGameWordSets();
        const set = sets.find((s) => s.id === selectedGameSetId);
        if (!set || !set.words.trim()) {
            if (toastManager) toastManager.show('Please choose a word set that has words!', 'error');
            return;
        }
        set.lastUsed = Date.now();
        saveGameWordSets(sets);
        title = set.name;
        wordList = set.words.split(',').map((w) => w.trim()).filter(Boolean);
    } else {
        let storyContent = '';
        if (selectedItemType === 'story') {
            const story = await storyManager.getUserStoryById(selectedGameSetId);
            if (!story) return;
            title = story.title;
            storyContent = story.content;
            if (story.images) {
                currentGameImages = Object.values(story.images).filter((img) => img && img.startsWith('data:'));
            }
        } else if (selectedItemType === 'default-story') {
            try {
                const res = await fetch('stories.json');
                const manifest = await res.json();
                const entry = manifest.find((s) => s.path === selectedGameSetId);
                title = (entry && entry.title) || 'Story Game';

                const response = await fetch(`${selectedGameSetId}story.txt`);
                storyContent = await response.text();

                const imgRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
                let m;
                while ((m = imgRegex.exec(storyContent)) !== null) {
                    const imgPath = m[1].trim();
                    if (!imgPath.startsWith('ai-gen-')) currentGameImages.push(`${selectedGameSetId}${imgPath}`);
                }
            } catch (e) {
                if (toastManager) toastManager.show('Could not load story words.', 'error');
                return;
            }
        }

        const rawWords = storyContent.replace(/\[IMAGE:.*?\]/g, '')
            .split(/[\s\n]+/)
            .map((w) => w.toLowerCase()
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
                .replace(/[^\w']/g, '')
            )
            .filter((w) => w.length > 2 && /[a-z]/.test(w));
        wordList = [...new Set(rawWords)];

        if (wordList.length < 4) {
            if (toastManager) toastManager.show('This story needs at least 4 words for a game!', 'error');
            return;
        }
    }

    const isPortrait = window.innerHeight > window.innerWidth;
    const gridSize = isPortrait ? [3, 4] : [4, 3];

    closeDialog(dom.gameSetSelectModal);
    uiManager.showView('game');
    gameManager.start({
        title,
        words: wordList,
        sampleSize: Math.min(wordList.length, 24)
    }, { gridSize });

    renderGameGrid();
    stopTimer();
    dom.gameTimer.textContent = '0s';
    gameTimerInterval = setInterval(() => {
        if (gameManager.state.active && dom.gameTimer) {
            dom.gameTimer.textContent = `${Math.floor((Date.now() - gameManager.state.startTime) / 1000)}s`;
        }
    }, 1000);
}
