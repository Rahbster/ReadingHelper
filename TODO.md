# Reading Helper Project Status 📖✨

## ✅ What's Working

### Core Application
- **Interactive Reader**: Tap-to-speak and syllable breakdown popups are fully functional.
- **Creator Mode**: Users can write stories, add phonetic guides, and manually upload images.
- **Local Storage**: Stories are saved and retrieved correctly using the `story-manager.js`.
- **PWA & Offline**: Service worker is configured to cache the app shell and local story assets.
- **P2P Sharing**: PeerJS integration allows for direct device-to-device story transfers.

### AI Integration (Text)
- **Refactored Architecture**: AI logic is isolated in `js/ai-manager.js`.
- **Prompt Generation**: Gemini (`gemini-flash-latest`) successfully analyzes story text and inserts `[IMAGE: prompt]` tags.
- **Guided Setup**: `instructions.html` provides a clear workflow for users to obtain their own API keys.

## ❌ What Needs Work

### AI Image Generation (Multimodal Image Modality)
**Status**: Troubleshooting persistent API errors across various Gemini and Imagen models in the experimental preview tier.
- **Quota Obstacles**: Most preview models (e.g., `gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`) are returning `RESOURCE_EXHAUSTED` (429) with a `limit: 0` error, indicating they are currently gated for the project/region.
- **Modality Support**: Standard models like `gemini-2.0-flash` and `gemini-flash-latest` are successfully connecting (200 OK) but either return text descriptions instead of binary data or fail with a 400 error stating the `IMAGE` modality is not supported.
- **Schema Mismatch**: Attempted integration with `imagen-4.0-fast-generate-001`, but discovered the `:generateContent` endpoint is incompatible with the Vertex AI `instances`/`parameters` JSON structure.
- **To Do**: 
    - Implement a more robust "Model Discovery" phase that checks for both availability and modality support.
    - Investigate if the Vertex AI `predict` endpoint can be used with the existing API key as a fallback for the Imagen 4 models.
    - Refine the user-facing "failed" state to distinguish between "Daily Limit Reached" and "Technical Error."

### UI & Synchronization
- **Live Preview**: Ensure the `storyDisplay` updates immediately when text is changed in the `storyInput` or when AI tags are inserted.
- **Resolve Controls**: Refine the "Generate Now" and "Retry" buttons so they only appear in Creator Mode and correctly trigger the generation queue in `ai-manager.js`.
**✅ Metadata Persistence**: `aiImageMetadata` is now correctly retrieved from the manager and bundled into the story object during saving.

### General Cleanup
- **Variable Scoping**: Verified consistency between `main.js` and `ai-manager.js`. Removed unused `generatedImageCache`.
- **Error Handling**: Replace technical 404/503 errors with child-friendly "AI is drawing..." or "AI is resting" messages in Reader Mode.

---
*Current Status: Refining Pollinations.ai integration to handle safety filters and header-based 403 errors.*