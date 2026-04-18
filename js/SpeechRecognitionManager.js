/**
 * Manages Speech-to-Text using the Web Speech API.
 */
export class SpeechRecognitionManager {
    constructor(onResultCallback, onStatusChange) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
        this.onResult = onResultCallback;
        this.onStatusChange = onStatusChange;
        this.isActive = false;
        this.language = 'en-US';

        if (this.recognition) {
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = this.language;

            this.recognition.onstart = () => this._handleStatus(true);
            this.recognition.onend = () => {
                this._handleStatus(false);
                // Auto-restart logic for iOS/Mobile stability if still active
                if (this.isActive) {
                    this.start();
                }
            };
            this.recognition.onerror = (event) => {
                console.error('[STT] Error:', event.error);
                if (event.error === 'not-allowed') this.isActive = false;
            };
            this.recognition.onresult = (event) => this._processResult(event);
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
        try {
            this.isActive = true;
            this.recognition.start();
        } catch (e) {
            // Ignore errors if already started
        }
    }

    stop() {
        this.isActive = false;
        if (this.recognition) {
            this.recognition.stop();
        }
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