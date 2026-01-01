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
export function saveUserStory(storyObject) {
    if (!storyObject.id) {
        storyObject.id = `user-story-${crypto.randomUUID()}`;
        storyObject.createdAt = Date.now();
    }

    const stories = getUserStories();
    const existingIndex = stories.findIndex(s => s.id === storyObject.id);

    if (existingIndex > -1) {
        stories[existingIndex] = { ...stories[existingIndex], ...storyObject, updatedAt: Date.now() };
    } else {
        stories.push(storyObject);
    }

    localStorage.setItem(USER_STORIES_KEY, JSON.stringify(stories));
    return stories;
}

/**
 * Deletes a user-created story from localStorage.
 * @param {string} storyId - The ID of the story to delete.
 * @returns {Array<Object>} The updated array of all user stories.
 */
export function deleteUserStory(storyId) {
    let stories = getUserStories();
    stories = stories.filter(s => s.id !== storyId);
    localStorage.setItem(USER_STORIES_KEY, JSON.stringify(stories));
    return stories;
}

/**
 * Retrieves a single user story by its ID.
 * @param {string} storyId - The ID of the story to retrieve.
 * @returns {Object|undefined} The story object, or undefined if not found.
 */
export function getUserStoryById(storyId) {
    const stories = getUserStories();
    return stories.find(s => s.id === storyId);
}