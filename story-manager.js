import { ImageStorage } from './js/storage-helper.js';

const USER_STORIES_KEY = 'reading-helper-user-stories';

/**
 * Retrieves all user-created stories from localStorage.
 * @returns {Array<Object>} An array of story objects.
 */
export function getUserStories() {
    const storiesJSON = localStorage.getItem(USER_STORIES_KEY);
    return storiesJSON ? JSON.parse(storiesJSON) : [];
}

/**
 * Saves a story to localStorage. If a story with the same id exists, it's updated.
 * Otherwise, it's added as a new story.
 * @param {Object} storyObject - The story object to save. It should not have an ID for new stories.
 * @returns {Array<Object>} The updated array of all user stories.
 */
export async function saveUserStory(storyObject) {
    let targetIndex = -1;
    if (!storyObject.id) {
        storyObject.id = `user-story-${crypto.randomUUID()}`;
        storyObject.createdAt = Date.now();
    }

    // Move images to IndexedDB storage to keep localStorage lightweight
    if (storyObject.images) {
        for (const [name, data] of Object.entries(storyObject.images)) {
            // Only save if it's new base64 data. 
            // If it's already a storage key (starts with img_), we don't need to re-save.
            if (typeof data === 'string' && data.startsWith('data:')) {
                const storageKey = `img_${storyObject.id}_${name}`;
                await ImageStorage.saveImage(storageKey, data);
                // Store the key in the JSON instead of the massive string
                storyObject.images[name] = storageKey;
            }
        }
    }

    const stories = getUserStories();
    const existingIndex = stories.findIndex(s => s.id === storyObject.id);

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
 * Deletes a user-created story from localStorage.
 * @param {string} storyId - The ID of the story to delete.
 * @returns {Array<Object>} The updated array of all user stories.
 */
export async function deleteUserStory(storyId) {
    let stories = getUserStories();
    const story = stories.find(s => s.id === storyId);

    // Clean up binary image assets in IndexedDB
    if (story && story.images) {
        for (const key of Object.values(story.images)) {
            if (typeof key === 'string' && key.startsWith('img_')) {
                await ImageStorage.deleteImage(key);
            }
        }
    }

    const filteredStories = stories.filter(s => s.id !== storyId);
    localStorage.setItem(USER_STORIES_KEY, JSON.stringify(filteredStories));
    return filteredStories;
}

/**
 * Retrieves a single user story by its ID.
 * @param {string} storyId - The ID of the story to retrieve.
 * @returns {Object|undefined} The story object, or undefined if not found.
 */
export async function getUserStoryById(storyId) {
    const stories = getUserStories();
    const story = stories.find(s => s.id === storyId);

    if (story && story.images) {
        // Rehydrate the story object with the actual base64 data for the UI
        const fullImages = {};
        for (const [name, storageKey] of Object.entries(story.images)) {
            if (typeof storageKey === 'string' && storageKey.startsWith('img_')) {
                const base64Data = await ImageStorage.getImage(storageKey);
                fullImages[name] = base64Data;
            } else {
                // Fallback for legacy stories still storing raw data or file paths
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

    // 1. Collect all image keys currently used in all stories
    stories.forEach(story => {
        if (story.images) {
            Object.values(story.images).forEach(value => {
                if (typeof value === 'string' && value.startsWith('img_')) {
                    referencedKeys.add(value);
                }
            });
        }
    });

    // 2. Identify keys in IndexedDB that are not in the referenced list
    const allStoredKeys = await ImageStorage.getAllKeys();
    const orphanedKeys = allStoredKeys.filter(key => !referencedKeys.has(key));

    // 3. Delete the orphans
    for (const key of orphanedKeys) {
        await ImageStorage.deleteImage(key);
    }

    return orphanedKeys.length;
}