# Reading Helper Architecture

## 📖 Overview
Reading Helper is a strictly front-end Progressive Web App (PWA) built using HTML5, CSS3, and Vanilla JavaScript (ES6 Modules). By avoiding heavy frontend frameworks, it remains lightweight and fast, making it ideal for mobile devices and educational settings.

## 🏗️ Core Architecture Components

### UI & Presentation Layer
*   **`index.html`**: The single-page shell of the application using semantic HTML5 and native `<dialog>` modals.
*   **`css/*.css`**: Unified CSS custom-property theming (`[data-theme="dark"]` & `light`), `100dvh` mobile layouts, `prefers-reduced-motion` accessibility, and **CSS Container Queries** (`22cqmin`) for flashcard text scaling.
*   **`js/main.js`**: Application coordinator wiring views, Story Teller, Karaoke Mode, Creator Mode, and P2P story previews.
*   **`js/ReaderEngine.js`**: Safe, XSS-hardened story tokenizer and paragraph renderer. Preserves exact character offsets for TTS word boundary synchronization and marks sentence boundaries.
*   **`js/KaraokeMatcher.js`**: Pure sequential word-alignment engine for Speech-to-Text, supporting homophones, numbers, custom pronunciations, phonetic signatures, Levenshtein edit distance, backtracking, and look-ahead skipping.
*   **`js/GameManager.js` & `js/GameUI.js`**: Manages Word Match state, Minimal Pairs distractor grouping, personalized "My Tricky Words" rounds, orientation-aware grids (3x4 / 4x3), and mastered-word firework celebrations.
*   **`js/UIManager.js` & `js/utils/dom-utils.js`**: Manages navigation, unified theme/sound preferences, HTML escaping, non-blocking `<dialog>` prompts/confirmations, and the child-safe Grown-Up Gate.

### Data & Persistence Layer
*   **`story-manager.js` & `js/storage-helper.js`**: Manages loading, saving, and deletion of custom stories.
    *   *LocalStorage* stores lightweight metadata (settings, Tricky Words statistics, user names, and story manifests).
    *   *IndexedDB* (`ReadingHelperAssets`) stores Base64 illustration assets so `localStorage` never hits quota limits.

### Connectivity & Networking (WebRTC)
*   **`js/peer-service.js` & `js/modals/peer_connection_modal.js`**: Wrapper and modal UI for `PeerJS` WebRTC data channels between host and joiner devices. Incoming stories open in a non-destructive preview banner before saving.
*   **`js/ChatManager.js`**: Manages side-channel chat messages between connected peers.

### Artificial Intelligence Layer
*   **`js/ai-manager.js`**: Interacts with Google Gemini (for story illustration planning and "Magic Image" prompt refinement) and Pollinations.ai (for rendering illustrations with consistent story seeds).

### Audio & Feedback Layer
*   **`js/VoiceManager.js`**: Web Speech Synthesis (`TTS`) with `requestAnimationFrame`-coalesced word boundary events, high-quality English voice prioritization, and syllable heuristics.
*   **`js/SpeechRecognitionManager.js`**: Web Speech Recognition (`STT`) with silent mobile auto-restart and transient-error backoff.
*   **`js/sound-effects.js`**: Procedural Web Audio chimes, error tones, celebration fanfares, and mobile haptics (`navigator.vibrate`) with a mute toggle.

### Offline, PWA & Testing
*   **`sw.js` & `manifest.json`**: Precaches the app shell and WebP story illustrations (`~1.27 MB` total), caches Google Fonts at runtime, and handles query-string PWA shortcuts (`?mode=game`, `?mode=dashboard`) offline.
*   **`tests/run-tests.mjs`**: Zero-dependency Node ES module unit test suite (`npm test`).
