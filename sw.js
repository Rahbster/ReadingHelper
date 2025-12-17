const CACHE_NAME = 'reading-helper-cache-v2';
// App Shell - the core files for the app's functionality
const appShellFiles = [
    './',
    './index.html',
    './css/style.css',
    './js/main.js',
    './js/peer-service.js',
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
                const storyTextResponse = await fetch(`./${story.path}story.txt`);
                const storyText = await storyTextResponse.text();
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
                'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js' // Add external library
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