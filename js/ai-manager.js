let toastManager;
let renderStoryCallback;
let openNavCallback;

let aiImageMetadata = {}; 
let imageGenerationQueue = []; 
let isImageGenerationInProgress = false;

/**
 * Initializes the AI manager with necessary callbacks.
 */
export function init(options) {
    toastManager = options.toastManager;
    renderStoryCallback = options.renderStory;
    openNavCallback = options.openNav;
}

export function getMetadata() { return aiImageMetadata; }
export function setMetadata(data) { aiImageMetadata = data || {}; }
export function clearMetadata() { aiImageMetadata = {}; }

/**
 * Tests the Google AI API key.
 */
export async function testGeminiConnection(apiKey, statusEl) {
    if (!apiKey) {
        toastManager.show('Please enter an API key first.', 'info');
        if (statusEl) statusEl.textContent = '';
        return;
    }

    toastManager.show('Testing connection...', 'info', 3000);
    if (statusEl) {
        statusEl.textContent = '⏳';
        statusEl.title = 'Testing...';
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (response.ok) {
            const hasFlash = data.models?.some(m => m.name.includes('gemini-2.5-flash'));
            const hasFlashImage = data.models?.some(m => m.name.includes('gemini-2.5-flash-image'));
            
            console.log('Detected AI Models. Text (2.5 Flash):', hasFlash, 'Image (2.5 Flash Image):', hasFlashImage);
            
            if (statusEl) {
                statusEl.textContent = '✅';
                statusEl.title = `Key is valid. Using Gemini 2.5 Flash for text and images.`;
            }
            toastManager.show('Connection successful!', 'success');
            if (!hasFlash || !hasFlashImage) console.warn('Warning: Required Gemini 2.5 models not found. AI features may fail.');
        } else {
            if (statusEl) statusEl.textContent = '❌';
            throw new Error(data.error?.message || `API returned status ${response.status}`);
        }
    } catch (error) {
        if (statusEl) statusEl.textContent = '❌';
        toastManager.show(`Connection failed: ${error.message}`, 'error');
    }
}

/**
 * Uses Gemini to rewrite the story with image tags.
 */
export async function illustrateStory(storyText, updateInputCallback) {
    const apiKey = localStorage.getItem('google_ai_api_key');
    if (!apiKey) {
        toastManager.show('Please enter your Google AI API Key in Settings.', 'error', 6000);
        openNavCallback();
        return;
    }

    toastManager.show('Gemini is illustrating your story...', 'info', 5000);

    try {
        // Using gemini-2.5-flash for stable March 2026 quota and performance.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Read the following story and rewrite it, inserting exactly three [IMAGE: prompt] tags at significant scene breaks. The prompt inside the brackets must be extremely brief (under 10 words). Output ONLY the rewritten story text without any markdown formatting. Story: ${storyText}`
                    }]
                }]
            })
        });

        const data = await response.json();
        if (response.status === 404) {
            throw new Error("Model retired! Please update the model ID in ai-manager.js.");
        }
        if (response.status === 429) {
            const retryInfo = data.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
            const delay = retryInfo?.retryDelay || "60s";
            throw new Error(`Gemini is busy (Daily Quota). Please wait ${delay} before trying again.`);
        }
        if (!response.ok) throw new Error(data.error?.message || 'API Error');

        let illustratedStory = data.candidates?.[0]?.content?.parts?.[0]?.text;
        illustratedStory = illustratedStory.replace(/```[a-z]*\n?|```/gi, '').trim();

        if (illustratedStory) {
            const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
            const tagsToProcess = [...illustratedStory.matchAll(imageRegex)];
            let finalStory = illustratedStory;

            for (const tagMatch of tagsToProcess) {
                const prompt = tagMatch[1].trim();
                const fileName = `ai-gen-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
                aiImageMetadata[fileName] = { prompt: prompt, status: 'pending' };
                finalStory = finalStory.replace(tagMatch[0], `[IMAGE: ${fileName}]`);
            }

            updateInputCallback(finalStory);
            renderStoryCallback();
            toastManager.show('Magic Illustrations added!', 'success');
        }
    } catch (error) {
        toastManager.show(`Illustration failed: ${error.message}`, 'error');
    }
}

/**
 * Inserts a single AI image tag based on selection.
 */
export async function insertMagicImage(storyText, start, end, updateInputCallback) {
    const selectedText = storyText.substring(start, end).trim();
    if (!selectedText) {
        toastManager.show('Please highlight the scene you want to illustrate.', 'info');
        return;
    }

    const apiKey = localStorage.getItem('google_ai_api_key');
    if (!apiKey) {
        openNavCallback();
        return;
    }

    toastManager.show('Creating magic illustration...', 'info', 5000);

    try {
        // Using gemini-2.5-flash for high stable RPD limits.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Context: "${storyText}"\n\nScene: "${selectedText}"\n\nTask: Generate a single extremely brief (under 10 words) image prompt for this scene. Output ONLY: [IMAGE: prompt]`
                    }]
                }]
            })
        });

        const data = await response.json();
        if (response.status === 404) {
            throw new Error("Model retired! Please update the model ID in ai-manager.js.");
        }
        if (response.status === 429) {
            const retryInfo = data.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
            const delay = retryInfo?.retryDelay || "60s";
            throw new Error(`Gemini is busy (Daily Quota). Please wait ${delay} before trying again.`);
        }
        if (!response.ok) throw new Error(data.error?.message || 'API Error');

        const illustratedTag = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (illustratedTag?.includes('[IMAGE:')) {
            const cleanTag = illustratedTag.replace(/```[a-z]*\n?|```/gi, '').trim();
            const promptMatch = cleanTag.match(/\[IMAGE:\s*(.*?)\s*\]/);
            const prompt = promptMatch ? promptMatch[1].trim() : "Story Illustration";

            const fileName = `ai-gen-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
            aiImageMetadata[fileName] = { prompt: prompt, status: 'pending' };

            const before = storyText.substring(0, end);
            const after = storyText.substring(end);
            updateInputCallback(`${before}\n\n[IMAGE: ${fileName}]\n\n${after}`);
            renderStoryCallback();
        }
    } catch (error) {
        toastManager.show(`Failed: ${error.message}`, 'error');
    }
}

/**
 * Background image generation logic.
 */
async function generateAiImage(fileName, sessionImages, localImageUrls) {
    const metadata = aiImageMetadata[fileName];
    if (!metadata) return;
    const apiKey = localStorage.getItem('google_ai_api_key');
    if (!apiKey) throw new Error("API Key missing");
    
    // Sanitize prompt: Certain words like "Cockapoo" often trigger false-positive 403 safety blocks.
    let safePrompt = metadata.prompt
        .replace(/cockapoo/gi, 'curly-haired dog')
        .replace(/basenji/gi, 'small short-haired dog');

    try {
        metadata.status = 'generating';
        renderStoryCallback();

        // Using gemini-2.5-flash-image for free-tier image generation via multimodal output.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ 
                    parts: [{ text: `Generate a 1024x1024 storybook style illustration of: ${safePrompt}` }] 
                }],
                generationConfig: { 
                    responseModalities: ["IMAGE"],
                    candidateCount: 1 
                }
            })
        });
        
        const data = await response.json();
        if (response.status === 403) {
            throw new Error("Safety Filter / Blocked by Gemini");
        }
        if (response.status === 404) {
            throw new Error("Model retired or not available. Check your API key region.");
        }
        if (response.status === 429) {
            const retryInfo = data.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
            const delay = retryInfo?.retryDelay || "60s";
            throw new Error(`Gemini is busy. Please wait ${delay}.`);
        }
        if (!response.ok) throw new Error(data.error?.message || 'API Error');

        // Extract Base64 from multimodal response
        const base64Data = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
        if (!base64Data) throw new Error("No image data returned.");

        const dataUrl = `data:image/png;base64,${base64Data}`;
        sessionImages[fileName] = dataUrl;
        localImageUrls[fileName] = dataUrl;
        metadata.status = 'success';
        renderStoryCallback();
    } catch (error) {
        metadata.status = 'failed';
        metadata.errorMessage = error.message;
        renderStoryCallback();
    }
}

export async function processQueue(sessionImages, localImageUrls) {
    if (isImageGenerationInProgress || imageGenerationQueue.length === 0) return;
    isImageGenerationInProgress = true;
    while (imageGenerationQueue.length > 0) {
        const fileName = imageGenerationQueue.shift();
        if (aiImageMetadata[fileName]?.status !== 'success') {
            await generateAiImage(fileName, sessionImages, localImageUrls);
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    isImageGenerationInProgress = false;
}

export function retryGeneration(fileName, sessionImages, localImageUrls) {
    if (!imageGenerationQueue.includes(fileName)) {
        const metadata = aiImageMetadata[fileName];
        if (metadata) {
            metadata.status = 'pending';
            imageGenerationQueue.push(fileName);
            processQueue(sessionImages, localImageUrls);
        }
    }
}