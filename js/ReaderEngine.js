/**
 * ReaderEngine.js
 * Safe paragraph-preserving story renderer, word tokenizer with exact character offsets,
 * and sentence range calculator for Story Teller TTS synchronization.
 */

import { escapeHtml } from './utils/dom-utils.js';

/**
 * Splits story text into an ordered array of tokens preserving exact character offsets
 * into the original string:
 *  - { type: 'image', raw, identifier, start, end }
 *  - { type: 'newline', raw, start, end }
 *  - { type: 'word', raw, start, end, sentenceEnd }
 *  - { type: 'punct', raw, start, end }
 *
 * Leading/trailing quotes (e.g. 'Yes!' or “Hello”) are separated into 'punct' tokens so
 * speakable words never include outer quote marks.
 *
 * @param {string} text
 * @returns {Array<object>}
 */
export function tokenizeStory(text) {
    if (!text) return [];

    // Match [IMAGE: ...], paragraph breaks (\r?\n)+, words (letters/numbers with optional internal apostrophes/hyphens), or other chars
    const masterRegex = /(\[IMAGE:[^\]]*\])|(\r?\n[\r\n \t]*)|([A-Za-z0-9]+(?:['\u2019-][A-Za-z0-9]+)*)|([^\[A-Za-z0-9\r\n]+|\[)/g;
    const rawTokens = [];
    let match;

    while ((match = masterRegex.exec(text)) !== null) {
        const full = match[0];
        const start = match.index;
        const end = start + full.length;

        if (match[1]) {
            const inner = match[1].slice(7, -1).trim();
            rawTokens.push({ type: 'image', raw: full, identifier: inner, start, end });
        } else if (match[2]) {
            rawTokens.push({ type: 'newline', raw: full, start, end });
        } else if (match[3] && /[A-Za-z]/.test(match[3])) {
            rawTokens.push({ type: 'word', raw: full, start, end, sentenceEnd: false });
        } else {
            rawTokens.push({ type: 'punct', raw: full, start, end });
        }
    }

    // Second pass: mark sentenceEnd = true on words followed by sentence-ending punctuation,
    // paragraph breaks, image blocks, or end-of-story.
    let lastWordToken = null;
    for (let i = 0; i < rawTokens.length; i++) {
        const tok = rawTokens[i];
        if (tok.type === 'word') {
            lastWordToken = tok;
        } else if (lastWordToken) {
            if (tok.type === 'newline' || tok.type === 'image') {
                lastWordToken.sentenceEnd = true;
                lastWordToken = null;
            } else if (tok.type === 'punct' && /[.!?]/.test(tok.raw)) {
                lastWordToken.sentenceEnd = true;
                lastWordToken = null;
            }
        }
    }
    if (lastWordToken) {
        lastWordToken.sentenceEnd = true;
    }

    return rawTokens;
}

/**
 * Renders an `[IMAGE: ...]` token into safe, escaped HTML while preserving compatibility
 * with `ai-manager.js` metadata and session image maps.
 */
function renderImageBlock(identifier, options) {
    const {
        aiMetadata = {},
        sessionImages = {},
        localImageUrls = {},
        currentStoryPath = '',
        isCreatorMode = false
    } = options;

    const isAiGenerated = identifier.startsWith('ai-gen-');
    const isFilePath = !isAiGenerated && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(identifier);

    if (isFilePath) {
        const imageName = identifier.split('/').pop();
        const rawSrc = localImageUrls[imageName] || `${currentStoryPath}${identifier}`.replace(/ /g, '%20');
        const safeSrc = escapeHtml(rawSrc);
        const titleAttr = isCreatorMode ? ` title="${escapeHtml(identifier)}"` : '';
        return `<img src="${safeSrc}" alt="Story illustration" class="story-image" loading="lazy"${titleAttr}>`;
    }

    if (isAiGenerated) {
        const fileName = identifier;
        const safeFileName = escapeHtml(fileName);
        let metadata = aiMetadata[fileName];

        if (!metadata) {
            const base64Data = sessionImages[fileName];
            if (base64Data) {
                metadata = { prompt: 'Loaded AI Image', status: 'success' };
                aiMetadata[fileName] = metadata;
                localImageUrls[fileName] = base64Data;
            } else {
                metadata = { prompt: 'AI Image', status: 'pending' };
                aiMetadata[fileName] = metadata;
            }
        }

        const safePrompt = escapeHtml(metadata.prompt || 'Story illustration');

        if (metadata.status === 'success' && localImageUrls[fileName]) {
            const safeSrc = escapeHtml(localImageUrls[fileName]);
            const titleAttr = isCreatorMode ? ` title="${safePrompt}"` : '';
            return `<img src="${safeSrc}" alt="${safePrompt}" class="story-image"${titleAttr}>`;
        }

        if (metadata.status === 'generating') {
            return `<div id="${safeFileName}" class="ai-prompt-placeholder generating" title="Drawing: ${safePrompt}"><div class="spinner"></div><span>Drawing: <i>${safePrompt}</i></span></div>`;
        }

        if (metadata.status === 'failed') {
            const retryBtn = isCreatorMode ? `<button type="button" class="retry-image-btn" data-filename="${safeFileName}">Retry</button>` : '';
            let errorText = 'The AI illustrator is taking a short break.';
            if (metadata.errorCode === 429) {
                errorText = 'The AI artist is taking a break! Check back in a few minutes.';
            } else if (metadata.errorCode === 403) {
                errorText = "The AI couldn't quite see that picture. Let's try another word!";
            } else if (isCreatorMode) {
                errorText = `Failed: ${metadata.errorMessage || 'Unknown error'}`;
            }
            const errorIcon = metadata.errorCode === 403 ? '🎨 ' : (isCreatorMode ? '❌ ' : '🎨 ');
            const safeErrorTitle = escapeHtml(metadata.errorMessage || 'Unknown error');
            return `<div id="${safeFileName}" class="ai-prompt-placeholder failed" title="${safeErrorTitle}"><span>${errorIcon}${escapeHtml(errorText)}</span>${retryBtn}</div>`;
        }

        const generateBtn = isCreatorMode ? `<button type="button" class="retry-image-btn" data-filename="${safeFileName}">Generate Now</button>` : '';
        const pendingText = isCreatorMode ? `Pending: ${metadata.prompt || ''}` : 'An illustration is coming soon!';
        return `<div id="${safeFileName}" class="ai-prompt-placeholder pending" title="${safePrompt}"><div class="spinner"></div><span>${escapeHtml(pendingText)}</span>${generateBtn}</div>`;
    }

    const safeIdentifier = escapeHtml(identifier);
    return `<div class="ai-prompt-placeholder" title="AI Image Prompt: ${safeIdentifier}">🎨 <i>${safeIdentifier}</i></div>`;
}

/**
 * Converts full story text into safe paragraph-structured HTML with interactive `.speakable-word` spans.
 * @param {string} text
 * @param {object} [options={}]
 * @returns {string}
 */
export function buildStoryHtml(text, options = {}) {
    if (!text || !text.trim()) {
        return '<p class="story-empty-hint">The story will appear here. Tap on any word to hear it read aloud.</p>';
    }

    const tokens = tokenizeStory(text);
    const blocks = [];
    let currentParagraphParts = [];

    const flushParagraph = () => {
        if (currentParagraphParts.length > 0) {
            const inner = currentParagraphParts.join('').trim();
            if (inner) {
                blocks.push(`<p class="story-paragraph">${inner}</p>`);
            }
            currentParagraphParts = [];
        }
    };

    for (const tok of tokens) {
        if (tok.type === 'newline') {
            flushParagraph();
        } else if (tok.type === 'image') {
            flushParagraph();
            blocks.push(renderImageBlock(tok.identifier, options));
        } else if (tok.type === 'word') {
            const endAttr = tok.sentenceEnd ? ' data-sentence-end="true"' : '';
            currentParagraphParts.push(
                `<span class="speakable-word" tabindex="0" data-start="${tok.start}" data-end="${tok.end}"${endAttr}>${escapeHtml(tok.raw)}</span>`
            );
        } else {
            currentParagraphParts.push(escapeHtml(tok.raw));
        }
    }
    flushParagraph();

    return blocks.join('\n');
}

/**
 * Computes the `[start, end]` inclusive word-index range for the next sentence chunk
 * in Story Teller mode. Caps run-on sentences at `maxWords` so browser TTS engines
 * never hit Chrome's ~15-second utterance cutoff.
 *
 * @param {Array<{start:number, end:number, sentenceEnd:boolean}>} wordMetadata
 * @param {number} startIndex
 * @param {number} [maxWords=35]
 * @returns {{ start: number, end: number }}
 */
export function computeNextSentenceRange(wordMetadata, startIndex, maxWords = 35) {
    if (!wordMetadata || wordMetadata.length === 0) {
        return { start: 0, end: 0 };
    }
    const safeStart = Math.max(0, Math.min(startIndex, wordMetadata.length - 1));
    let endIndex = safeStart;
    const hardLimit = Math.min(wordMetadata.length - 1, safeStart + maxWords - 1);

    for (let i = safeStart; i <= hardLimit; i++) {
        endIndex = i;
        if (wordMetadata[i].sentenceEnd || i === wordMetadata.length - 1) {
            break;
        }
    }
    return { start: safeStart, end: endIndex };
}
