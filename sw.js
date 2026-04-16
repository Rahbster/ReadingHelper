const CACHE_NAME = 'reading-helper-cache-v7';
// App Shell - the core files for the app's functionality
const appShellFiles = [
    './',
    './index.html',
    './manifest.json',
    './stories.json',
    './story-manager.js',
    './js/main.js',
    './js/ai-manager.js',
    './js/ToastManager.js',
    './js/ChatManager.js',
    './js/UIManager.js',
    './js/storage-helper.js',
    './js/peer-service.js',
    './js/modals/peer_connection_modal.js',
    './css/style.css',
    './css/sidenav.css',
    './css/chat.css',
    './css/peer_connection_modal.css',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/icon-tab.png',
    './instructions.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            // First, fetch the list of stories
            const storyListResponse = await fetch('./stories.json');
            const stories = await storyListResponse.json();

            // Dynamically generate the list of core story files to cache
            const storyFiles = stories.flatMap(story => [
                `./${story.path}story.txt`,
                `./${story.path}phonetics.json`,
                `./${story.path}pronunciations.json`
            ]);

            // Fetch each story.txt to find and cache its images
            const imageFiles = [];
            const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;

            for (const story of stories) {
                let storyText = "";
                try {
                    const storyTextResponse = await fetch(`./${story.path}story.txt`);
                    if (storyTextResponse.ok) {
                        storyText = await storyTextResponse.text();
                    }
                } catch (e) {
                    console.warn(`Could not fetch story text for ${story.path} during cache-fill.`);
                }
                
                let match;
                while ((match = imageRegex.exec(storyText)) !== null) {
                    const imagePath = match[1].trim();
                    // Construct the full path relative to the service worker
                    const fullImagePath = `./${story.path}${imagePath}`.replace(/ /g, '%20');
                    imageFiles.push(fullImagePath);
                }
            }

            // Combine all files to be cached. Use a Set to handle any potential duplicates.
            const urlsToCache = [...new Set([
                ...appShellFiles, 
                ...storyFiles, 
                ...imageFiles,
                './js/peerjs.min.js' // Cache the local library file - This line is already correct.
            ])];

            const cache = await caches.open(CACHE_NAME);
            console.log('Opened cache. Caching files:', urlsToCache);
            
            // Use a more robust caching method that doesn't fail if one file is missing.
            // This is better than cache.addAll() which fails the entire operation.
            const cachePromises = urlsToCache.map(async (url) => {
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        await cache.put(url, response);
                    }
                } catch (error) {
                    console.warn(`Failed to cache ${url}:`, error);
                }
            });
            await Promise.all(cachePromises);
        })()
    );
});

self.addEventListener('fetch', (event) => {
    // Only intercept GET requests from our own origin to avoid issues with external APIs
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) {
                return response;
            }
            return fetch(event.request);
        })
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});