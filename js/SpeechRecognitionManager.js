/**
 * Manages Speech-to-Text using the Web Speech API.
 * Smoothly handles mobile browser auto-timeouts without UI flicker or tight error loops.
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

        if (this.recognition) {
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = this.language;

            this.recognition.onstart = () => {
                this._consecutiveErrors = 0;
                this._handleStatus(true);
            };

            this.recognition.onend = () => {
                // Mobile browsers periodically end continuous sessions between breaths.
                // Restart silently while still active instead of flickering status to false.
                if (this.isActive) {
                    const delay = Math.min(1000, 150 + this._consecutiveErrors * 250);
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

                // 'no-speech' is normal when the reader pauses; count other transient errors
                if (event.error !== 'no-speech') {
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
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        if (finalTranscript || interimTranscript) {
            this.onResult({
                final: finalTranscript.trim().toLowerCase(),
                interim: interimTranscript.trim().toLowerCase()
            });
        }
    }

    start() {
        if (!this.recognition) return;
        clearTimeout(this._restartTimer);
        this._consecutiveErrors = 0;
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
