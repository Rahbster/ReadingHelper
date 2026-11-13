/**
 * ReaderEngine.js
 * Safe paragraph-preserving story renderer, word tokenizer with exact character offsets,
 * and speech-segment builder for Story Teller TTS synchronization.
 */

import { escapeHtml } from './utils/dom-utils.js';
import { normalizeWordForSpeech } from './VoiceManager.js';

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

    // Second pass: mark sentenceEnd = true on words followed by terminal punctuation (. ! ?),
    // paragraph breaks, image blocks, or end-of-story.
    // Exceptions that stay in one smooth utterance:
    //  1. Ellipses (... or …) such as "Then out rose... A truly magnificent broom!"
    //  2. Exclamations/questions followed on the same line by a lowercase dialogue tag
    //     such as `"This porridge is too hot!" she exclaimed.` or `'Yes!' cried the witch.`
    let lastWordToken = null;
    for (let i = 0; i < rawTokens.length; i++) {
        const tok = rawTokens[i];
        if (tok.type === 'word') {
            lastWordToken = tok;
        } else if (lastWordToken) {
            if (tok.type === 'newline' || tok.type === 'image') {
                lastWordToken.sentenceEnd = true;
                lastWordToken = null;
            } else if (tok.type === 'punct') {
                const strippedQuotes = tok.raw.replace(/[\s"'”’)\]]+/g, '');
                const isEllipsis = /^(?:\.{2,}|…+)$/.test(strippedQuotes);
                if (!isEllipsis && /[.!?]/.test(strippedQuotes)) {
                    // Peek ahead to next word before any newline/image
                    let nextWord = null;
                    for (let j = i + 1; j < rawTokens.length; j++) {
                        if (rawTokens[j].type === 'newline' || rawTokens[j].type === 'image') break;
                        if (rawTokens[j].type === 'word') {
                            nextWord = rawTokens[j];
                            break;
                        }
                    }
                    const continuesLowercase = Boolean(nextWord && /^[a-z]/.test(nextWord.raw));
                    if (!continuesLowercase) {
                        lastWordToken.sentenceEnd = true;
                        lastWordToken = null;
                    }
                }
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
        return `<div class="story-empty-state">
            <p class="story-empty-hint">Pick a story to start reading! Tap any word to hear it aloud, or press and hold to see its syllables.</p>
            <button type="button" class="theme-button" data-action="open-story-modal">📖 Choose a Story</button>
        </div>`;
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

/**
 * Normalizes inter-word characters for natural TTS prosody (removes [IMAGE] tags and
 * markdown emphasis markers like *wisp*, while preserving commas and pauses).
 * @param {string} rawBetween
 * @returns {string}
 */
function cleanInterWordText(rawBetween) {
    if (!rawBetween) return ' ';
    const cleaned = rawBetween
        .replace(/\[IMAGE:[^\]]*\]/g, ' ')
        .replace(/[*_~`"“”'‘’]+/g, '')
        .replace(/\s*(?:--|—)\s*/g, ', ')
        .replace(/\s+/g, ' ');
    return cleaned || ' ';
}

/**
 * Builds a TTS-ready speech segment for `[range.start .. range.end]` with an exact
 * character-offset map into `spokenText` (eliminating `charIndex` drift when words like
 * "Ahhh" -> "aah" change length) plus syllable-weighted duration estimates for browsers
 * whose cloud voices omit `onboundary` events.
 *
 * @param {string} text
 * @param {Array<{start:number, end:number, sentenceEnd:boolean}>} wordMetadata
 * @param {{ start: number, end: number }} range
 * @param {Object<string,string>} [customPronunciations={}]
 */
export function buildSpeechSegment(text, wordMetadata, range, customPronunciations = {}) {
    if (!text || !wordMetadata || wordMetadata.length === 0) {
        return { spokenText: '', words: [], pauseAfterSentenceMs: 180 };
    }

    const parts = [];
    const words = [];
    let cursor = 0;

    for (let i = range.start; i <= range.end; i++) {
        const meta = wordMetadata[i];
        if (!meta) continue;

        if (i > range.start) {
            const prevMeta = wordMetadata[i - 1];
            const rawBetween = text.substring(prevMeta.end, meta.start);
            const cleanedBetween = cleanInterWordText(rawBetween);
            parts.push(cleanedBetween);
            cursor += cleanedBetween.length;
        }

        const rawWord = text.substring(meta.start, meta.end);
        const spokenWord = normalizeWordForSpeech(rawWord, customPronunciations) || rawWord;
        const spokenStart = cursor;
        const spokenEnd = cursor + spokenWord.length;

        parts.push(spokenWord);
        cursor = spokenEnd;

        // Inspect punctuation immediately following this word for cadence fallback timing
        const nextBoundary = i < range.end
            ? wordMetadata[i + 1].start
            : Math.min(text.length, meta.end + 6);
        const trailingGap = text.substring(meta.end, nextBoundary);
        let pauseMs = 0;
        if (/(?:\.{2,}|…)/.test(trailingGap)) pauseMs = 260;
        else if (/[,;:\u2014]/.test(trailingGap)) pauseMs = 175;

        const vowelGroups = (spokenWord.match(/[aeiouy]+/gi) || []).length || 1;
        const extraChars = Math.max(0, spokenWord.length - 4);
        const estimatedDurationMs = Math.max(150, 90 + vowelGroups * 115 + extraChars * 14) + pauseMs;

        words.push({
            wordIndex: i,
            rawWord,
            spokenWord,
            spokenStart,
            spokenEnd,
            estimatedDurationMs
        });
    }

    // Preserve terminal sentence punctuation (. ! ?) for natural TTS intonation,
    // and add a warmer pause after paragraph / illustration breaks.
    const lastMeta = wordMetadata[range.end];
    const nextWordStart = wordMetadata[range.end + 1] ? wordMetadata[range.end + 1].start : text.length;
    const afterEnd = lastMeta ? text.substring(lastMeta.end, nextWordStart) : '';
    const terminalMatch = afterEnd.match(/^[\s"'”’)\]*_]*([.!?]+)/);
    if (terminalMatch && terminalMatch[1]) {
        parts.push(terminalMatch[1]);
    }

    const hasParagraphOrImageBreak = /\r?\n|\[IMAGE:/.test(afterEnd);
    const pauseAfterSentenceMs = hasParagraphOrImageBreak ? 420 : 170;

    return {
        spokenText: parts.join(''),
        words,
        pauseAfterSentenceMs
    };
}

/**
 * Maps a `SpeechSynthesisEvent.charIndex` within `segment.spokenText` back to the exact
 * story `wordIndex`, gracefully handling boundary events that land on opening quotes or whitespace.
 *
 * @param {{ spokenText: string, words: Array<{wordIndex:number, spokenStart:number, spokenEnd:number}> }} segment
 * @param {number} spokenCharIndex
 * @returns {number|null}
 */
export function resolveSegmentWordIndex(segment, spokenCharIndex) {
    if (!segment || !segment.words || segment.words.length === 0) return null;
    const idx = Math.max(0, Number(spokenCharIndex) || 0);

    for (let k = 0; k < segment.words.length; k++) {
        const item = segment.words[k];
        if (idx >= item.spokenStart && idx < item.spokenEnd) {
            return item.wordIndex;
        }
        if (idx < item.spokenStart) {
            const gap = segment.spokenText.slice(idx, item.spokenStart);
            // If charIndex points to opening quotes/spaces right before this word (not a trailing comma of previous word)
            if (!/[A-Za-z0-9]/.test(gap) && (k === 0 || !/^[,;:.!?]/.test(gap))) {
                return item.wordIndex;
            }
            return k > 0 ? segment.words[k - 1].wordIndex : item.wordIndex;
        }
    }

    return segment.words[segment.words.length - 1].wordIndex;
}
