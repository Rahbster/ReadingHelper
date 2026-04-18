# Reading Helper 📖✨

A simple, installable Progressive Web App (PWA) designed to help young children practice their reading skills by providing on-demand audio for any word in a given text.

## ❤️ The Goal

This project was created to provide a personalized and interactive reading tool for my young daughter. It transforms any piece of text into an interactive experience where she can get instant help with words she finds challenging, empowering her to read more independently and confidently.

## ✨ Key Features

*   **Word Match Game:** A fun, interactive flashcard game designed for auditory recognition. Features "Tricky Pairs" support to help children distinguish between similar-sounding or similar-looking words (e.g., "tree" vs "three").
*   **Customizable Word Sets:** Parents can create and manage specific lists of words (e.g., "Week 1", "Sight Words") via the Dashboard to target specific learning goals.
*   **Dynamic Game Layouts:** The game automatically adjusts between a 3x4 grid (portrait) and a 4x3 grid (landscape) to maximize screen space on iPhones, iPads, and desktops.
*   **Adaptive Text Scaling:** Flashcards use CSS Container Queries to ensure word text dynamically fills the available card space, remaining legible on all device sizes.
*   **Victory Celebrations:** Completing a game triggers a celebratory firework show using the words the child just mastered, providing positive reinforcement.
*   **Advanced Speech Synthesis:** High-quality voice selection (prioritizing "Natural" and "Google" voices) with specialized enunciation logic for short, tricky words like "the" and "fast".
*   **AI Story Illustrator:** Use Google Gemini to automatically analyze your story and insert context-aware image tags, then generate unique illustrations using AI.
*   **Magic Image:** Highlight a specific sentence or paragraph and let the AI "Magic Image" creator build a detailed visual prompt and illustration for that exact scene.
*   **Quick Chat:** Chat directly with a connected peer while sharing stories.
*   **Tap-to-Speak:** Simply tap on any word in a story to hear it read aloud using the browser's built-in speech synthesis. This provides immediate auditory feedback, reinforcing word recognition.
*   **Syllable Breakdown:** Long-press on any word to see it broken down into syllables. Optimized for touch with unified Pointer Events to prevent accidental scrolling triggers.
*   **Story Sharing:** Connect two devices directly (Peer-to-Peer) to share stories instantly. Great for parents sending stories to a child's device.
*   **Creator Mode:** Write your own stories, add images, and customize phonetic guides or pronunciations for specific words.
*   **Parent's Dashboard:** The app tracks which words are tapped most frequently, displaying them in a "Tricky Words" list. This provides a simple, data-driven way for parents to see which words their child may need extra practice with.
*   **PWA & Offline Ready:** As a Progressive Web App, it can be easily "installed" on any device (desktop, tablet, or phone) for a native app-like experience. It works completely offline after the first visit.
*   **Dark Mode:** Toggle between light and dark themes for comfortable reading in any lighting.
*   **Simple & Clean UI:** Features a child-friendly interface with large, readable text and minimal distractions.

## 🛠️ Technology Stack

This project is built with a focus on simplicity and modern web standards, without any external frameworks.

*   **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6 Modules)
*   **Speech**: Web Speech Synthesis API
*   **Offline Capabilities**: Progressive Web App (PWA) with a Service Worker and Web App Manifest.
*   **Connectivity**: PeerJS for WebRTC peer-to-peer data transfer.
*   **Data Storage**:
    *   **localStorage** for tracking word statistics, user settings, and story metadata.
    *   **IndexedDB** via a custom storage helper for robust management of large AI-generated image assets.

## 🚀 How to Run Locally

1.  Ensure all the project files are in a single directory.
2.  Due to the use of ES6 Modules and the Service Worker, you must run the project from a local web server.
3.  A simple way to do this is to use a tool like the **Live Server** extension for Visual Studio Code.
    *   Install the extension.
    *   Right-click on `index.html` and select "Open with Live Server".
4.  The application will open in your default web browser.

## 📖 How to Use

1.  **Read a Story**:
    *   Click the "Choose a Story" button in the header.
    *   Select a story from the library. You can read built-in stories, ones you've created, or stories shared with you.
    *   Tap words to hear them. Long-press words to see syllables.

2.  **Create a Story**:
    *   Go to the Dashboard and click "Enter Creator Mode".
    *   Type or paste your story.
    *   Add images, custom phonetics (e.g., "Colonel" -> "Ker-nel"), or specific pronunciations.
    *   Save the story to your local library.

3.  **Connect & Share**:
    *   Open the menu and click "Connect".
    *   Choose "Host" on one device and "Joiner" on the other. Enter the Host ID.
    *   Once connected, go to your library and click "Share" on any local story to send it to the connected peer.

4.  **Dashboard**:
    *   Check the "Tricky Words" list to see which words are being looked up the most.

5.  **Install as an App**:
    *   On a supported browser (like Chrome or Edge on desktop, or Safari on iOS/Android), look for the "Install" icon in the address bar or the "Add to Home Screen" option in the share menu.
    *   This will add the Reading Helper to your device for easy, offline access.

---

This project was lovingly crafted with assistance from **Gemini Code Assist**, which helped brainstorm features, generate the initial code structure, and refine the implementation.