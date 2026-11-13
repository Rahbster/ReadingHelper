import { ImageStorage } from './js/storage-helper.js';

const USER_STORIES_KEY = 'reading-helper-user-stories';

function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Retrieves all user-created stories from localStorage.
 * @returns {Array<Object>} An array of story objects.
 */
export function getUserStories() {
    try {
        const storiesJSON = localStorage.getItem(USER_STORIES_KEY);
        const parsed = storiesJSON ? JSON.parse(storiesJSON) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn('Could not parse user stories from localStorage:', e);
        return [];
    }
}

/**
 * Saves a story to localStorage. If a story with the same id exists, it's updated.
 * Otherwise, it's added as a new story.
 */
export async function saveUserStory(storyObject) {
    let targetIndex = -1;
    if (!storyObject.id) {
        storyObject.id = `user-story-${generateId()}`;
        storyObject.createdAt = Date.now();
    }

    // Move images to IndexedDB storage to keep localStorage lightweight
    if (storyObject.images) {
        for (const [name, data] of Object.entries(storyObject.images)) {
            if (typeof data === 'string' && data.startsWith('data:')) {
                const storageKey = `img_${storyObject.id}_${name}`;
                await ImageStorage.saveImage(storageKey, data);
                storyObject.images[name] = storageKey;
            }
        }
    }

    const stories = getUserStories();
    const existingIndex = stories.findIndex((s) => s.id === storyObject.id);

    if (existingIndex > -1) {
        stories[existingIndex] = { ...stories[existingIndex], ...storyObject, updatedAt: Date.now() };
        targetIndex = existingIndex;
    } else {
        stories.push(storyObject);
        targetIndex = stories.length - 1;
    }

    localStorage.setItem(USER_STORIES_KEY, JSON.stringify(stories));
    return stories[targetIndex];
}

/**
 * Deletes a user-created story from localStorage and removes its IndexedDB images.
 */
export async function deleteUserStory(storyId) {
    const stories = getUserStories();
    const story = stories.find((s) => s.id === storyId);

    if (story && story.images) {
        for (const key of Object.values(story.images)) {
            if (typeof key === 'string' && key.startsWith('img_')) {
                await ImageStorage.deleteImage(key);
            }
        }
    }

    const filteredStories = stories.filter((s) => s.id !== storyId);
    localStorage.setItem(USER_STORIES_KEY, JSON.stringify(filteredStories));
    return filteredStories;
}

/**
 * Retrieves a single user story by its ID, rehydrating IndexedDB image assets.
 */
export async function getUserStoryById(storyId) {
    const stories = getUserStories();
    const story = stories.find((s) => s.id === storyId);

    if (story && story.images) {
        const fullImages = {};
        for (const [name, storageKey] of Object.entries(story.images)) {
            if (typeof storageKey === 'string' && storageKey.startsWith('img_')) {
                const base64Data = await ImageStorage.getImage(storageKey);
                fullImages[name] = base64Data;
            } else {
                fullImages[name] = storageKey;
            }
        }
        story.images = fullImages;
    }

    return story;
}

/**
 * Identifies and deletes images in IndexedDB that are no longer referenced by any story.
 */
export async function cleanupOrphanedImages() {
    const stories = getUserStories();
    const referencedKeys = new Set();

    stories.forEach((story) => {
        if (story.images) {
            Object.values(story.images).forEach((value) => {
                if (typeof value === 'string' && value.startsWith('img_')) {
                    referencedKeys.add(value);
                }
            });
        }
    });

    const allStoredKeys = await ImageStorage.getAllKeys();
    const orphanedKeys = allStoredKeys.filter((key) => !referencedKeys.has(key));

    for (const key of orphanedKeys) {
        await ImageStorage.deleteImage(key);
    }

    return orphanedKeys.length;
}
