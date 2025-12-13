const CACHE_NAME = 'reading-helper-cache-v1';
// App Shell - the core files for the app's functionality
const appShellFiles = [
    './',
    './index.html',
    './css/style.css',
    './js/main.js',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './stories.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            // First, fetch the list of stories
            const storyListResponse = await fetch('./stories.json');
            const stories = await storyListResponse.json();

            // Dynamically generate the list of story files to cache
            const storyFiles = stories.flatMap(story => [
                `./${story.path}story.txt`,
                `./${story.path}phonetics.json`,
                `./${story.path}pronunciations.json`
            ]);

            // Also cache any images mentioned in the stories
            // Note: This requires a more complex build step to parse story.txt files.
            // For now, we'll stick to caching the main assets.

            const urlsToCache = [...appShellFiles, ...storyFiles];

            const cache = await caches.open(CACHE_NAME);
            console.log('Opened cache. Caching files:', urlsToCache);
            await cache.addAll(urlsToCache);
        })()
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - return response
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