const CACHE_NAME = 'reading-helper-cache-v21';

// App Shell - core files required for offline startup
const appShellFiles = [
    './',
    './index.html',
    './manifest.json',
    './stories.json',
    './story-manager.js',
    './js/main.js',
    './js/ReaderEngine.js',
    './js/KaraokeMatcher.js',
    './js/sound-effects.js',
    './js/utils/dom-utils.js',
    './js/utils/perf-monitor.js',
    './js/ai-manager.js',
    './js/ToastManager.js',
    './js/ChatManager.js',
    './js/UIManager.js',
    './js/VoiceManager.js',
    './js/SpeechRecognitionManager.js',
    './js/GameUI.js',
    './js/storage-helper.js',
    './js/peerjs.min.js',
    './js/GameManager.js',
    './js/peer-service.js',
    './js/modals/peer_connection_modal.js',
    './css/style.css',
    './css/sidenav.css',
    './css/chat.css',
    './css/peer_connection_modal.css',
    './icons/icon-180x180.png',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/icon-tab.png',
    './icons/reading-icon.svg',
    './instructions.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            self.skipWaiting();

            let stories = [];
            try {
                const storyListResponse = await fetch('./stories.json', { cache: 'no-cache' });
                if (storyListResponse.ok) {
                    stories = await storyListResponse.json();
                }
            } catch (e) {
                console.warn('Could not fetch stories.json during SW install:', e);
            }

            const storyFiles = stories.flatMap((story) => [
                `./${story.path}story.txt`,
                `./${story.path}phonetics.json`,
                `./${story.path}pronunciations.json`
            ]);

            const imageFiles = [];
            await Promise.all(
                stories.map(async (story) => {
                    try {
                        const storyTextResponse = await fetch(`./${story.path}story.txt`, { cache: 'no-cache' });
                        if (!storyTextResponse.ok) return;
                        const storyText = await storyTextResponse.text();
                        const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
                        let match;
                        while ((match = imageRegex.exec(storyText)) !== null) {
                            const imagePath = match[1].trim();
                            const fullImagePath = `./${story.path}${imagePath}`.replace(/ /g, '%20');
                            imageFiles.push(fullImagePath);
                        }
                    } catch (e) {
                        console.warn(`Could not fetch story text for ${story.path} during cache-fill.`);
                    }
                })
            );

            const urlsToCache = [...new Set([
                ...appShellFiles,
                ...storyFiles,
                ...imageFiles
            ])];

            const cache = await caches.open(CACHE_NAME);
            await Promise.all(
                urlsToCache.map(async (url) => {
                    try {
                        const response = await fetch(url, { cache: 'no-cache' });
                        if (response.ok) {
                            await cache.put(url, response);
                        }
                    } catch (error) {
                        console.warn(`Failed to cache ${url}:`, error);
                    }
                })
            );
        })()
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === self.location.origin;
    const isGoogleFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

    if (!isSameOrigin && !isGoogleFont) {
        return;
    }

    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);

            // 1. Try exact cache match first
            const exactMatch = await cache.match(event.request);
            if (exactMatch) return exactMatch;

            // 2. For same-origin requests with query params (e.g. PWA shortcuts ?mode=game),
            // match ignoring search query so offline shortcuts work reliably
            if (isSameOrigin && url.search) {
                const strippedMatch = await cache.match(event.request, { ignoreSearch: true });
                if (strippedMatch) return strippedMatch;
            }

            // 3. Fetch from network and cache fonts/same-origin assets for offline reuse
            try {
                const networkResponse = await fetch(event.request);
                if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque') && isGoogleFont) {
                    cache.put(event.request, networkResponse.clone());
                }
                return networkResponse;
            } catch (err) {
                if (event.request.mode === 'navigate') {
                    const fallback = await cache.match('./index.html');
                    if (fallback) return fallback;
                }
                throw err;
            }
        })()
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        (async () => {
            await self.clients.claim();
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map((cacheName) => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })()
    );
});
