/**
 * storage-helper.js
 * A robust wrapper for IndexedDB to handle large image assets for the Reading Helper PWA.
 * This prevents the story JSON from bloating and hitting localStorage limits.
 */

const DB_NAME = 'ReadingHelperAssets';
const DB_VERSION = 1;
const STORE_NAME = 'generated_images';

export const ImageStorage = {
    db: null,

    /**
     * Initializes the database.
     */
    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => reject(event.target.error);
        });
    },

    /**
     * Saves image data (base64 or Blob) keyed by a unique tag (e.g., "story123_pig_image").
     */
    async saveImage(key, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(data, key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Retrieves the stored image data.
     */
    async getImage(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Deletes stored image data.
     */
    async deleteImage(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Retrieves all keys currently in the store.
     */
    async getAllKeys() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
};