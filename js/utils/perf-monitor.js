/**
 * perf-monitor.js
 * Lightweight client-side performance & latency collector active ONLY on localhost/127.0.0.1.
 * Zero runtime cost in production builds.
 */

const IS_LOCAL_DEV = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
);

const MAX_BUFFER = 500;
const events = [];
let pendingBatch = [];
let flushTimer = null;

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

function summarizeMetric(list, field) {
    const vals = list
        .map((e) => Number(e[field]))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
    if (!vals.length) return null;
    const sum = vals.reduce((acc, v) => acc + v, 0);
    return {
        count: vals.length,
        min: Number(vals[0].toFixed(2)),
        median: quantile(vals, 0.5),
        p95: quantile(vals, 0.95),
        max: Number(vals[vals.length - 1].toFixed(2)),
        avg: Number((sum / vals.length).toFixed(2))
    };
}

function scheduleFlush() {
    if (!IS_LOCAL_DEV || flushTimer !== null || pendingBatch.length === 0) return;
    flushTimer = setTimeout(flushNow, 800);
}

function flushNow() {
    flushTimer = null;
    if (!IS_LOCAL_DEV || pendingBatch.length === 0) return;
    const batch = pendingBatch;
    pendingBatch = [];

    const body = JSON.stringify({ events: batch });
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const ok = navigator.sendBeacon('/__perf', body);
            if (ok) return;
        }
        if (typeof fetch === 'function') {
            fetch('/__perf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: true
            }).catch(() => {});
        }
    } catch (e) {
        // Ignore dev telemetry transport errors
    }
}

export function recordPerf(type, data = {}) {
    if (!IS_LOCAL_DEV) return;
    const entry = {
        type,
        ts: Number(performance.now().toFixed(2)),
        wallTime: Date.now(),
        ...data
    };
    events.push(entry);
    if (events.length > MAX_BUFFER) {
        events.shift();
    }
    pendingBatch.push(entry);
    scheduleFlush();
}

export function getPerfSummary() {
    const byType = (t) => events.filter((e) => e.type === t);
    const karaokeSteps = byType('karaoke-step');
    const ttsStarts = byType('tts-start');
    const storyLoads = byType('story-load');
    const longTasks = byType('longtask');
    const layoutShifts = byType('layout-shift');
    const totalCls = layoutShifts.reduce((acc, s) => acc + (Number(s.value) || 0), 0);

    return {
        totalEvents: events.length,
        paints: byType('paint'),
        lcp: byType('lcp').slice(-1)[0] || null,
        clsTotal: Number(totalCls.toFixed(5)),
        layoutShiftCount: layoutShifts.length,
        longTaskCount: longTasks.length,
        longTasks: summarizeMetric(longTasks, 'durationMs'),
        storyLoadMs: summarizeMetric(storyLoads, 'durationMs'),
        karaokeMicStartMs: summarizeMetric(byType('karaoke-mic-start'), 'durationMs'),
        karaokeMatcherMs: summarizeMetric(karaokeSteps, 'matcherMs'),
        karaokeDomMs: summarizeMetric(karaokeSteps, 'domMs'),
        karaokeInterResultGapMs: summarizeMetric(karaokeSteps, 'interEventGapMs'),
        ttsStartupMs: summarizeMetric(ttsStarts, 'startupMs'),
        recentVoices: [...new Set(ttsStarts.map((e) => `${e.voice || 'default'} (local=${Boolean(e.localService)})`))]
    };
}

function initWebVitalsObservers() {
    if (!IS_LOCAL_DEV || typeof PerformanceObserver === 'undefined') return;

    const supported = PerformanceObserver.supportedEntryTypes || [];

    if (supported.includes('paint')) {
        try {
            const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    recordPerf('paint', { name: entry.name, startTimeMs: Number(entry.startTime.toFixed(2)) });
                }
            });
            po.observe({ type: 'paint', buffered: true });
        } catch (e) {}
    }

    if (supported.includes('largest-contentful-paint')) {
        try {
            const po = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const last = entries[entries.length - 1];
                if (last) {
                    recordPerf('lcp', {
                        startTimeMs: Number(last.startTime.toFixed(2)),
                        size: last.size,
                        tag: last.element ? last.element.tagName : null
                    });
                }
            });
            po.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (e) {}
    }

    if (supported.includes('layout-shift')) {
        try {
            const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput && entry.value > 0.0005) {
                        recordPerf('layout-shift', {
                            value: Number(entry.value.toFixed(5)),
                            startTimeMs: Number(entry.startTime.toFixed(2))
                        });
                    }
                }
            });
            po.observe({ type: 'layout-shift', buffered: true });
        } catch (e) {}
    }

    if (supported.includes('longtask')) {
        try {
            const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    recordPerf('longtask', {
                        durationMs: Number(entry.duration.toFixed(2)),
                        startTimeMs: Number(entry.startTime.toFixed(2))
                    });
                }
            });
            po.observe({ type: 'longtask', buffered: true });
        } catch (e) {}
    }

    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow();
    });

    window.__readingHelperPerf = {
        events,
        summary: getPerfSummary,
        flush: flushNow
    };
}

initWebVitalsObservers();
