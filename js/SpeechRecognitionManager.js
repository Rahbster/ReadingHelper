/**
 * Manages Speech-to-Text using the Web Speech API.
 * Smoothly handles mobile/desktop browser auto-timeouts without UI flicker or dropped interim segments.
 */
export class SpeechRecognitionManager {
    constructor(onResultCallback, onStatusChange, onErrorCallback = null) {
        const SpeechRecognition = typeof window !== 'undefined'
            ? (window.SpeechRecognition || window.webkitSpeechRecognition)
            : null;
        this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
        this.onResult = onResultCallback;
        this.onStatusChange = onStatusChange;
        this.onError = onErrorCallback;
        this.isActive = false;
        this.language = 'en-US';
        this._restartTimer = null;
        this._consecutiveErrors = 0;
        this._sessionEpoch = 0;

        if (this.recognition) {
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = this.language;
            this.recognition.maxAlternatives = 1;

            this.recognition.onstart = () => {
                this._consecutiveErrors = 0;
                this._handleStatus(true);
            };

            this.recognition.onend = () => {
                // Commit any open interim segment before restarting so words never reset across breaths
                if (this.onResult) {
                    this.onResult({ segmentBoundary: true });
                }

                // Mobile & desktop browsers periodically end continuous sessions between breaths.
                // Restart almost immediately (30ms) on clean breath ends, backing off only on errors.
                if (this.isActive) {
                    this._sessionEpoch++;
                    const delay = this._consecutiveErrors === 0
                        ? 30
                        : Math.min(1000, 150 + this._consecutiveErrors * 250);
                    clearTimeout(this._restartTimer);
                    this._restartTimer = setTimeout(() => {
                        if (!this.isActive) return;
                        try {
                            this.recognition.start();
                        } catch (e) {
                            // Ignore if already started
                        }
                    }, delay);
                } else {
                    this._handleStatus(false);
                }
            };

            this.recognition.onerror = (event) => {
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

    _handleStatus(status) {
        if (this.onStatusChange) this.onStatusChange(status);
    }

    _processResult(event) {
        if (!this.onResult) return;

        let combinedInterim = '';
        let firstInterimIdx = null;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            const transcript = (res[0] && res[0].transcript ? res[0].transcript : '').trim().toLowerCase();
            if (!transcript) continue;

            if (res.isFinal) {
                // Deliver each finalized utterance segment with its unique segment ID
                this.onResult({
                    final: transcript,
                    interim: '',
                    segmentIndex: `${this._sessionEpoch}:${i}`
                });
            } else {
                if (firstInterimIdx === null) firstInterimIdx = i;
                combinedInterim += (combinedInterim ? ' ' : '') + transcript;
            }
        }

        // Also deliver any active interim hypothesis immediately (even if an earlier segment just finalized!)
        if (combinedInterim) {
            this.onResult({
                final: '',
                interim: combinedInterim,
                segmentIndex: `${this._sessionEpoch}:${firstInterimIdx}`
            });
        }
    }

    start() {
        if (!this.recognition) return;
        clearTimeout(this._restartTimer);
        this._consecutiveErrors = 0;
        this._sessionEpoch++;
        this.isActive = true;
        try {
            this.recognition.start();
        } catch (e) {
            // Already started
            this._handleStatus(true);
        }
    }

    stop() {
        this.isActive = false;
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
    }
}
