# Reading Helper 📖✨

A simple, installable Progressive Web App (PWA) designed to help young children practice their reading skills by providing on-demand audio for any word in a given text.

## ❤️ The Goal

This project was created to provide a personalized and interactive reading tool for my young daughter. It transforms any piece of text into an interactive experience where she can get instant help with words she finds challenging, empowering her to read more independently and confidently.

## ✨ Key Features

*   **Tap-to-Speak:** Simply tap on any word in a story to hear it read aloud using the browser's built-in speech synthesis. This provides immediate auditory feedback, reinforcing word recognition.
*   **Parent's Dashboard:** The app tracks which words are tapped most frequently, displaying them in a "Tricky Words" list. This provides a simple, data-driven way for parents to see which words their child may need extra practice with.
*   **PWA & Offline Ready:** As a Progressive Web App, it can be easily "installed" on any device (desktop, tablet, or phone) for a native app-like experience. It works completely offline after the first visit.
*   **Simple & Clean UI:** Features a child-friendly interface with large, readable text and minimal distractions, keeping the focus on the story.
*   **Custom Content:** Paste any story, paragraph, or list of words into the app to create a new reading session.

## 🛠️ Technology Stack

This project is built with a focus on simplicity and modern web standards, without any external frameworks.

*   **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6 Modules)
*   **Speech**: Web Speech Synthesis API
*   **Offline Capabilities**: Progressive Web App (PWA) with a Service Worker and Web App Manifest.
*   **Data Storage**: Browser `localStorage` for tracking word statistics.

## 🚀 How to Run Locally

1.  Ensure all the project files are in a single directory.
2.  Due to the use of ES6 Modules and the Service Worker, you must run the project from a local web server.
3.  A simple way to do this is to use a tool like the **Live Server** extension for Visual Studio Code.
    *   Install the extension.
    *   Right-click on `index.html` and select "Open with Live Server".
4.  The application will open in your default web browser.

## 📖 How to Use

1.  **Load a Story**:
    *   Open the application.
    *   Click the "Choose a Story" button to open the library.
    *   Select a story from the list. The story text and its associated learning aids will be loaded automatically.

2.  **Read and Interact**:
    *   The story will appear in the main display area.
    *   Tap on any word to hear it spoken aloud. The word will be highlighted as it's read.

3.  **Check the Dashboard**:
    *   Click the "Dashboard" button in the header.
    *   Here you will see a list of the most frequently tapped words, helping you identify which ones might be challenging.
    *   Click "Back to Reader" to return to the story.

4.  **Install as an App**:
    *   On a supported browser (like Chrome or Edge on desktop, or Safari on iOS/Android), look for the "Install" icon in the address bar or the "Add to Home Screen" option in the share menu.
    *   This will add the Reading Helper to your device for easy, offline access.

---

This project was lovingly crafted with assistance from **Gemini Code Assist**, which helped brainstorm features, generate the initial code structure, and refine the implementation.