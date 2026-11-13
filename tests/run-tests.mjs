/**
 * Zero-dependency automated unit test suite for ReadingHelper core modules.
 * Run with: node tests/run-tests.mjs
 */

import assert from 'assert';
import fs from 'fs';
import { escapeHtml, cleanWordToken } from '../js/utils/dom-utils.js';
import { getPhoneticCode, editDistance, isWordsMatch, KaraokeSession } from '../js/KaraokeMatcher.js';
import {
    tokenizeStory,
    buildStoryHtml,
    computeNextSentenceRange,
    buildSpeechSegment,
    resolveSegmentWordIndex
} from '../js/ReaderEngine.js';
import { getSyllables, normalizeWordForSpeech, selectPreferredVoice } from '../js/VoiceManager.js';
import { GameManager, getMinimalPairPartners } from '../js/GameManager.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (err) {
        failed++;
        console.error(`  FAIL  ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

console.log('Running ReadingHelper Unit Tests...\n');

test('escapeHtml sanitizes XSS payloads in text and attributes', () => {
    const payload = `<img src=x onerror="alert('xss')">&`;
    const escaped = escapeHtml(payload);
    assert.strictEqual(escaped, '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;');
});

test('cleanWordToken strips outer single/curly quotes while keeping internal apostrophes', () => {
    assert.strictEqual(cleanWordToken("'Yes!'"), 'yes');
    assert.strictEqual(cleanWordToken("“Don’t”"), "don't");
    assert.strictEqual(cleanWordToken("witch's"), "witch's");
    assert.strictEqual(cleanWordToken("ear-splitting,"), 'ear-splitting');
});

test('tokenizeStory separates dialogue quotes, preserves character offsets, and marks sentence ends', () => {
    const sample = `'Yes!' cried the witch.\n\n[IMAGE: images/dragon.webp]\n\nShe flew away.`;
    const tokens = tokenizeStory(sample);
    const words = tokens.filter((t) => t.type === 'word');

    assert.deepStrictEqual(words.map((w) => w.raw), ['Yes', 'cried', 'the', 'witch', 'She', 'flew', 'away']);

    // Verify exact substring offsets into original text
    for (const w of words) {
        assert.strictEqual(sample.substring(w.start, w.end), w.raw);
    }

    // 'Yes!' continues into lowercase dialogue tag 'cried', so sentence ends at 'witch.' and 'away.'
    assert.strictEqual(words[0].sentenceEnd, false, 'Yes! followed by lowercase dialogue tag stays in same sentence');
    assert.strictEqual(words[1].sentenceEnd, false, 'cried should not end sentence');
    assert.strictEqual(words[3].sentenceEnd, true, 'witch. should end sentence');
    assert.strictEqual(words[6].sentenceEnd, true, 'away. should end sentence');
});

test('computeNextSentenceRange chunks sentences instead of reading whole story at once', () => {
    const sample = 'One morning she woke up. She ate porridge! Then she went outside?';
    const words = tokenizeStory(sample).filter((t) => t.type === 'word');

    const r1 = computeNextSentenceRange(words, 0);
    assert.deepStrictEqual(r1, { start: 0, end: 4 }); // "One morning she woke up"

    const r2 = computeNextSentenceRange(words, r1.end + 1);
    assert.deepStrictEqual(r2, { start: 5, end: 7 }); // "She ate porridge"

    const r3 = computeNextSentenceRange(words, r2.end + 1);
    assert.deepStrictEqual(r3, { start: 8, end: 11 }); // "Then she went outside"
});

test('buildStoryHtml wraps paragraphs in <p> blocks, renders empty-state CTA, and neutralizes XSS', () => {
    const emptyHtml = buildStoryHtml('');
    assert.ok(emptyHtml.includes('story-empty-state'), 'Empty story should render welcoming empty state');
    assert.ok(emptyHtml.includes('data-action="open-story-modal"'), 'Empty story should render Choose a Story CTA');

    const malicious = `First paragraph <script>alert(1)</script>.\n\n[IMAGE: bad.webp" onerror="alert(2)]\n\nSecond paragraph.`;
    const html = buildStoryHtml(malicious, { isCreatorMode: true });

    assert.ok(html.includes('<p class="story-paragraph">'), 'Should create paragraph tags');
    assert.ok(!html.includes('<script>'), 'Should escape raw script tags');
    assert.ok(!html.includes('" onerror="'), 'Should escape injected image attributes');
});

test('VoiceManager.getSyllables strips quotes and applies phonetic overrides', () => {
    const phonetics = { porridge: 'por-ij', happily: 'hap-i-lee' };
    assert.strictEqual(getSyllables('"porridge!"', phonetics), 'por-ij');
    assert.strictEqual(getSyllables("'happily'", phonetics), 'hap-i-lee');
    assert.strictEqual(getSyllables('the', phonetics), 'the');
});

test('VoiceManager.normalizeWordForSpeech fixes interjections ("Ahhh"), stretched words, and ALL-CAPS spell-outs', () => {
    assert.strictEqual(normalizeWordForSpeech('Ahhh'), 'aah');
    assert.strictEqual(normalizeWordForSpeech('"Ahhh,"'), 'aah');
    assert.strictEqual(normalizeWordForSpeech('Buzzz-off'), 'buzz-off');
    assert.strictEqual(normalizeWordForSpeech('Nooo'), 'no');
    assert.strictEqual(normalizeWordForSpeech('Sooo'), 'so');
    assert.strictEqual(normalizeWordForSpeech('whoooosh'), 'whoosh');
    assert.strictEqual(normalizeWordForSpeech('AND'), 'and');
    assert.strictEqual(normalizeWordForSpeech("THAT'S"), "that's");
    assert.strictEqual(normalizeWordForSpeech('WITCH'), 'witch');
    assert.strictEqual(normalizeWordForSpeech('TV'), 'TV');
    assert.strictEqual(normalizeWordForSpeech('plait', { plait: 'plat' }), 'plat');
});

test('VoiceManager.selectPreferredVoice prioritizes warm natural voices and avoids novelty voices', () => {
    const mockVoices = [
        { name: 'Albert', lang: 'en-US', localService: true },
        { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
        { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true },
        { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false }
    ];
    const picked = selectPreferredVoice(mockVoices);
    assert.strictEqual(picked.name, 'Microsoft Aria Online (Natural) - English (United States)');

    const sapiOnly = selectPreferredVoice(mockVoices.slice(0, 3));
    assert.strictEqual(sapiOnly.name, 'Microsoft Zira - English (United States)');
});

test('buildSpeechSegment & resolveSegmentWordIndex align highlights accurately even when word length changes', () => {
    const sample = `"Ahhh, this *wisp* is right," she said.\n\nNext paragraph.`;
    const tokens = tokenizeStory(sample);
    const words = tokens.filter((t) => t.type === 'word');
    const range = computeNextSentenceRange(words, 0);

    const segment = buildSpeechSegment(sample, words, range, { ahhh: 'aah' });
    assert.strictEqual(segment.spokenText, 'aah, this wisp is right, she said.');
    assert.strictEqual(segment.pauseAfterSentenceMs, 420);

    // "Ahhh" (4 chars) became "aah" (3 chars); verify subsequent word offsets stay exact
    for (const item of segment.words) {
        assert.strictEqual(segment.spokenText.slice(item.spokenStart, item.spokenEnd), item.spokenWord);
    }

    assert.strictEqual(resolveSegmentWordIndex(segment, 0), 0); // "aah"
    assert.strictEqual(resolveSegmentWordIndex(segment, 5), 1); // "this"
    assert.strictEqual(resolveSegmentWordIndex(segment, 10), 2); // "wisp" (no asterisks)
    assert.strictEqual(resolveSegmentWordIndex(segment, 29), 6); // "said"

    // Ellipsis should not split dramatic continuations into choppy fragments
    const ellipsisSample = 'Then out rose... A truly magnificent broom!';
    const ellipsisWords = tokenizeStory(ellipsisSample).filter((t) => t.type === 'word');
    const ellipsisRange = computeNextSentenceRange(ellipsisWords, 0);
    assert.deepStrictEqual(ellipsisRange, { start: 0, end: 6 });
});

test('KaraokeMatcher matches homophones, digits, custom pronunciations, and tracks skips', () => {
    assert.strictEqual(isWordsMatch('3', 'three'), true);
    assert.strictEqual(isWordsMatch('their', "they're"), true);
    assert.strictEqual(isWordsMatch('nite', 'knight'), true);
    assert.strictEqual(isWordsMatch('kernel', 'colonel', { colonel: 'kernel' }), true);
    assert.strictEqual(getPhoneticCode('phone'), 'fon');
    assert.strictEqual(editDistance('forest', 'forrest'), 1);

    const session = new KaraokeSession();
    const storyWords = ['Once', 'upon', 'a', 'magical', 'time'];
    const res1 = session.processResult({
        final: 'once upon time',
        storyWords
    });
    // 'Once' -> correct (0), 'upon' -> correct (1), 'time' -> skips 2 ('a') and 3 ('magical'), marks 4 ('time') correct
    assert.strictEqual(res1.readingPointer, 5);
    assert.strictEqual(res1.completed, true);
    assert.deepStrictEqual(res1.trickyWords, ['magical']);
});

test('GameManager groups minimal pairs and tracks mastered words through game over', () => {
    assert.ok(getMinimalPairPartners('tree').includes('three'));
    assert.ok(getMinimalPairPartners('was').includes('saw'));

    let finishedStats = null;
    const gm = new GameManager({
        onGameOver: (score, time, errors, masteredWords) => {
            finishedStats = { score, time, errors, masteredWords };
        }
    });

    gm.start({ words: ['tree', 'cat', 'three', 'dog'], sampleSize: 4 }, { gridSize: [2, 2] });
    assert.strictEqual(gm.state.totalWords, 4);

    // Wrong guess increments errors
    const wrongWord = gm.state.gridWords.find((w) => w !== gm.state.targetWord);
    assert.strictEqual(gm.handleChoice(wrongWord, 0), false);
    assert.strictEqual(gm.state.errors, 1);

    // Clear all 4 words
    while (gm.state.active) {
        const idx = gm.state.gridWords.findIndex((w) => w === gm.state.targetWord);
        assert.ok(idx >= 0, 'Target word must exist on grid');
        assert.strictEqual(gm.handleChoice(gm.state.targetWord, idx), true);
    }

    assert.ok(finishedStats !== null, 'Game should finish and invoke onGameOver');
    assert.strictEqual(finishedStats.errors, 1);
    assert.strictEqual(finishedStats.masteredWords.length, 4);
});

test('Project integrity: HTML IDs, Service Worker appShellFiles, Manifest icons, and Story images all exist', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

    for (const file of ['js/main.js', 'js/ChatManager.js']) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) {
            assert.ok(htmlIds.has(m[1]), `Missing id="${m[1]}" in index.html (referenced in ${file})`);
        }
    }

    const sw = fs.readFileSync('sw.js', 'utf8');
    const arrayBody = sw.match(/const appShellFiles = \[([\s\S]*?)\];/)[1];
    for (const m of arrayBody.matchAll(/'\.\/([^']*)'/g)) {
        const rel = m[1] || 'index.html';
        assert.ok(fs.existsSync(rel), `Missing Service Worker file: ${rel}`);
    }

    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    for (const icon of manifest.icons || []) {
        assert.ok(fs.existsSync(icon.src), `Missing manifest icon: ${icon.src}`);
    }
    for (const sc of manifest.shortcuts || []) {
        for (const icon of sc.icons || []) {
            assert.ok(fs.existsSync(icon.src), `Missing shortcut icon: ${icon.src}`);
        }
    }

    const stories = JSON.parse(fs.readFileSync('stories.json', 'utf8'));
    for (const s of stories) {
        const txtPath = `${s.path}story.txt`;
        assert.ok(fs.existsSync(txtPath), `Missing story text: ${txtPath}`);
        const txt = fs.readFileSync(txtPath, 'utf8');
        for (const im of txt.matchAll(/\[IMAGE:\s*(.*?)\s*\]/g)) {
            const imgPath = `${s.path}${im[1].trim()}`;
            assert.ok(fs.existsSync(imgPath), `Missing story image: ${imgPath}`);
        }
    }
});

test('UI/CSS regression guard: modal scroll containment, story-group flex-shrink protection, and inert sidenav', () => {
    const styleCss = fs.readFileSync('css/style.css', 'utf8');
    const sidenavCss = fs.readFileSync('css/sidenav.css', 'utf8');
    const html = fs.readFileSync('index.html', 'utf8');

    assert.ok(/\.story-group\s*\{[^}]*flex-shrink:\s*0/s.test(styleCss), '.story-group must have flex-shrink: 0 so stories are never squashed or clipped');
    assert.ok(/#story-list[\s\S]*?overscroll-behavior:\s*contain/.test(styleCss), '#story-list must contain scroll chaining');
    assert.ok(/body\.modal-open[\s\S]*?overflow:\s*hidden/.test(styleCss), 'body.modal-open must lock background scroll');
    assert.ok(/visibility:\s*hidden/.test(sidenavCss), 'Closed .sidenav must hide focusable children from Tab order');
    assert.ok(/<nav id="sidenav"[^>]*\binert\b/.test(html), 'Initial closed #sidenav in index.html must carry inert attribute');
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
