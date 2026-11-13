/**
 * scripts/dev-server.mjs
 * Zero-dependency local development & performance-telemetry server for ReadingHelper.
 * Usage: node scripts/dev-server.mjs [--port 8080] [--perf-log path/to/perf.jsonl]
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function getArg(flag, fallback) {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const PORT = Number(getArg('--port', process.env.PORT || 8080));
const PERF_LOG_PATH = getArg('--perf-log', '');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
};

const collectedEvents = [];
const MAX_STORED_EVENTS = 2000;

function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return Number((sorted[base] + rest * (sorted[base + 1] - sorted[base])).toFixed(2));
    }
    return Number(sorted[base].toFixed(2));
}

function summarize(list, field) {
    const vals = list
        .map((e) => Number(e[field]))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return {
        count: vals.length,
        min: vals[0],
        median: quantile(vals, 0.5),
        p95: quantile(vals, 0.95),
        max: vals[vals.length - 1],
        avg: Number((sum / vals.length).toFixed(2))
    };
}

function buildSummary() {
    const byType = (t) => collectedEvents.filter((e) => e.type === t);
    const karaokeSteps = byType('karaoke-step');
    const ttsStarts = byType('tts-start');
    const storyLoads = byType('story-load');
    const longTasks = byType('longtask');
    const shifts = byType('layout-shift');

    return {
        totalEvents: collectedEvents.length,
        paints: byType('paint').slice(-4),
        lcp: byType('lcp').slice(-1)[0] || null,
        clsTotal: Number(shifts.reduce((a, s) => a + (Number(s.value) || 0), 0).toFixed(5)),
        longTaskCount: longTasks.length,
        longTasksMs: summarize(longTasks, 'durationMs'),
        storyLoadMs: summarize(storyLoads, 'durationMs'),
        karaokeMicStartMs: summarize(byType('karaoke-mic-start'), 'durationMs'),
        karaokeMatcherMs: summarize(karaokeSteps, 'matcherMs'),
        karaokeDomMs: summarize(karaokeSteps, 'domMs'),
        karaokeInterEventGapMs: summarize(karaokeSteps, 'interEventGapMs'),
        ttsStartupMs: summarize(ttsStarts, 'startupMs'),
        voicesObserved: [...new Set(ttsStarts.map((e) => `${e.voice} (local=${e.localService})`))]
    };
}

function logPerfEntry(entry) {
    if (PERF_LOG_PATH) {
        try {
            fs.appendFileSync(PERF_LOG_PATH, `${JSON.stringify(entry)}\n`);
        } catch (e) {}
    }

    if (entry.type === 'story-load') {
        console.log(`[PERF] Story loaded (${entry.path}, ${entry.wordCount} words) in ${entry.durationMs}ms`);
    } else if (entry.type === 'karaoke-mic-start') {
        console.log(`[PERF] Karaoke mic ready in ${entry.durationMs}ms (on-device=${entry.processLocally})`);
    } else if (entry.type === 'tts-start') {
        console.log(`[PERF] TTS start in ${entry.startupMs}ms [voice="${entry.voice}", local=${entry.localService}, singleWord=${entry.isSingleWord}]`);
    } else if (entry.type === 'longtask') {
        console.warn(`[PERF][WARN] Main-thread Long Task: ${entry.durationMs}ms`);
    } else if (entry.type === 'layout-shift' && entry.value > 0.01) {
        console.warn(`[PERF][WARN] Layout Shift: ${entry.value}`);
    } else if (entry.type === 'karaoke-step' && (entry.matcherMs > 8 || entry.domMs > 8)) {
        console.warn(`[PERF][WARN] Slow Karaoke frame: matcher=${entry.matcherMs}ms, dom=${entry.domMs}ms`);
    }
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname === '/__perf') {
        if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
                if (body.length < 512 * 1024) body += chunk;
            });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    const incoming = Array.isArray(parsed.events) ? parsed.events : [];
                    for (const ev of incoming) {
                        collectedEvents.push(ev);
                        if (collectedEvents.length > MAX_STORED_EVENTS) collectedEvents.shift();
                        logPerfEntry(ev);
                    }
                } catch (e) {}
                res.writeHead(204, { 'Cache-Control': 'no-store' });
                res.end();
            });
            return;
        }

        if (req.method === 'GET') {
            const payload = parsedUrl.searchParams.get('raw') === '1'
                ? { summary: buildSummary(), recentEvents: collectedEvents.slice(-50) }
                : buildSummary();
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify(payload, null, 2));
            return;
        }
    }

    const relativeTarget = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(path.join(ROOT_DIR, relativeTarget));
    if (!safePath.startsWith(ROOT_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.stat(safePath, (err, stats) => {
        const finalPath = !err && stats.isDirectory() ? path.join(safePath, 'index.html') : safePath;
        fs.readFile(finalPath, (readErr, data) => {
            if (readErr) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end('Not Found');
                return;
            }
            const ext = path.extname(finalPath).toLowerCase();
            res.writeHead(200, {
                'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
                'Cache-Control': 'no-store, no-cache, must-revalidate'
            });
            res.end(data);
        });
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`ReadingHelper local test server running at http://localhost:${PORT}`);
    console.log(`Live performance summary endpoint: http://localhost:${PORT}/__perf`);
});
