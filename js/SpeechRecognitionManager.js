/**
 * Manages Speech-to-Text using the Web Speech API.
 * Smoothly handles mobile/desktop browser auto-timeouts, deduplicates already-emitted
 * final/interim segments, and enables low-latency on-device recognition when available.
 */

import { recordPerf } from './utils/perf-monitor.js';

export class SpeechRecognitionManager {
    constructor(onResultCallback, onStatusChange, onErrorCallback = null) {
        const SpeechRecognition = typeof window !== 'undefined'
            ? (window.SpeechRecognition || window.webkitSpeechRecognition)
            : null;
        this._SpeechRecognitionCtor = SpeechRecognition;
        this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
        this.onResult = onResultCallback;
        this.onStatusChange = onStatusChange;
        this.onError = onErrorCallback;
        this.isActive = false;
        this.language = 'en-US';
        this._restartTimer = null;
        this._consecutiveErrors = 0;
        this._sessionEpoch = 0;
        this._emittedFinalIndices = new Set();
        this._lastInterimSignature = '';
        this._canProcessLocally = false;
        this._usingProcessLocally = false;
        this._startRequestedAt = 0;
        this._lastResultAt = 0;

        if (this.recognition) {
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = this.language;
            this.recognition.maxAlternatives = 1;

            this._probeOnDeviceRecognition();

            this.recognition.onstart = () => {
                this._consecutiveErrors = 0;
                if (this._startRequestedAt > 0 && typeof performance !== 'undefined') {
                    recordPerf('karaoke-mic-start', {
                        durationMs: Number((performance.now() - this._startRequestedAt).toFixed(2)),
                        processLocally: this._usingProcessLocally
                    });
                    this._startRequestedAt = 0;
                }
                this._handleStatus(true);
            };

            this.recognition.onend = () => {
                // Commit any open interim segment before restarting so words never reset across breaths
                if (this.onResult) {
                    this.onResult({ segmentBoundary: true });
                }

                // Mobile & desktop browsers periodically end continuous sessions between breaths.
                // Restart almost immediately (10ms) on clean breath ends, backing off only on errors.
                if (this.isActive) {
                    this._resetEpochState();
                    const delay = this._consecutiveErrors === 0
                        ? 10
                        : Math.min(1000, 150 + this._consecutiveErrors * 250);
                    clearTimeout(this._restartTimer);
                    this._restartTimer = setTimeout(() => {
                        if (!this.isActive) return;
                        this._startRecognizerInstance();
                    }, delay);
                } else {
                    this._handleStatus(false);
                }
            };

            this.recognition.onerror = (event) => {
                // If experimental on-device mode wasn't ready in this browser, fall back seamlessly to cloud STT
                if (
                    this._usingProcessLocally &&
                    (event.error === 'language-not-supported' || event.error === 'service-not-allowed' || event.error === 'not-allowed')
                ) {
                    this._canProcessLocally = false;
                    this._usingProcessLocally = false;
                    try {
                        this.recognition.processLocally = false;
                    } catch (e) {}
                    if (event.error !== 'not-allowed') {
                        return;
                    }
                }

                const fatalErrors = ['not-allowed', 'service-not-allowed', 'audio-capture'];
                if (fatalErrors.includes(event.error)) {
                    console.error('[STT] Fatal error:', event.error);
                    this.isActive = false;
                    clearTimeout(this._restartTimer);
                    this._handleStatus(false);
                    if (this.onError) this.onError(event.error);
                    return;
                }

                // 'no-speech' and 'aborted' during stop/restart are normal; count other transient errors
                if (event.error !== 'no-speech' && event.error !== 'aborted') {
                    this._consecutiveErrors++;
                    console.warn('[STT] Transient error:', event.error);
                    if (this._consecutiveErrors >= 4) {
                        this.isActive = false;
                        clearTimeout(this._restartTimer);
                        this._handleStatus(false);
                        if (this.onError) this.onError(event.error);
                    }
                }
            };

            this.recognition.onresult = (event) => {
                this._consecutiveErrors = 0;
                this._processResult(event);
            };
        }
    }

    _probeOnDeviceRecognition() {
        const Ctor = this._SpeechRecognitionCtor;
        if (!Ctor || typeof Ctor.available !== 'function') return;
        try {
            const check = Ctor.available({ langs: [this.language], processLocally: true });
            if (check && typeof check.then === 'function') {
                check.then((status) => {
                    if (status === 'available') {
                        this._canProcessLocally = true;
                    }
                }).catch(() => {});
            }
        } catch (e) {
            // Browser uses older available() signature or does not support processLocally
        }
    }

    _resetEpochState() {
        this._sessionEpoch++;
        this._emittedFinalIndices.clear();
        this._lastInterimSignature = '';
    }

    _startRecognizerInstance() {
        if (!this.recognition) return;
        if (this._canProcessLocally && 'processLocally' in this.recognition) {
            try {
                this.recognition.processLocally = true;
                this._usingProcessLocally = true;
            } catch (e) {
                this._usingProcessLocally = false;
            }
        } else {
            this._usingProcessLocally = false;
        }

        try {
            this.recognition.start();
        } catch (e) {
            // Already started
            this._handleStatus(true);
        }
    }

    _handleStatus(status) {
        if (this.onStatusChange) this.onStatusChange(status);
    }

    _processResult(event) {
        if (!this.onResult) return;

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const interEventGapMs = this._lastResultAt > 0 ? Number((now - this._lastResultAt).toFixed(2)) : 0;
        this._lastResultAt = now;

        let combinedInterim = '';
        let firstInterimIdx = null;
        let startIdx = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
        if (startIdx < 0) startIdx = 0;

        for (let i = startIdx; i < event.results.length; ++i) {
            const res = event.results[i];
            if (!res) continue;

            if (res.isFinal) {
                // Prevent mobile/WebKit browsers (where resultIndex stays 0) from re-emitting old final segments
                if (this._emittedFinalIndices.has(i)) continue;
                this._emittedFinalIndices.add(i);
                this._lastInterimSignature = '';

                const transcript = (res[0] && res[0].transcript ? res[0].transcript : '').trim().toLowerCase();
                if (!transcript) continue;

                this.onResult({
                    final: transcript,
                    interim: '',
                    segmentIndex: `${this._sessionEpoch}:${i}`,
                    interEventGapMs
                });
            } else {
                const transcript = (res[0] && res[0].transcript ? res[0].transcript : '').trim().toLowerCase();
                if (!transcript) continue;
                if (firstInterimIdx === null) firstInterimIdx = i;
                combinedInterim += (combinedInterim ? ' ' : '') + transcript;
            }
        }

        // Also deliver active interim hypothesis immediately, skipping duplicate confidence-only ticks
        if (combinedInterim) {
            const segId = `${this._sessionEpoch}:${firstInterimIdx}`;
            const signature = `${segId}|${combinedInterim}`;
            if (signature === this._lastInterimSignature) return;
            this._lastInterimSignature = signature;

            this.onResult({
                final: '',
                interim: combinedInterim,
                segmentIndex: segId,
                interEventGapMs
            });
        }
    }

    start() {
        if (!this.recognition) return;
        clearTimeout(this._restartTimer);
        this._consecutiveErrors = 0;
        this._resetEpochState();
        this._lastResultAt = 0;
        this._startRequestedAt = typeof performance !== 'undefined' ? performance.now() : 0;
        this.isActive = true;
        this._startRecognizerInstance();
    }

    stop() {
        this.isActive = false;
        this._startRequestedAt = 0;
        clearTimeout(this._restartTimer);
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                // Ignore stop errors
            }
        }
        this._handleStatus(false);
    }

    isSupported() {
        return !!this.recognition;
    }

    setLanguage(lang) {
        this.language = lang;
        if (this.recognition) {
            this.recognition.lang = lang;
        }
        this._canProcessLocally = false;
        this._probeOnDeviceRecognition();
    }
}
