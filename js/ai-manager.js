let toastManager;
let renderStoryCallback;

let aiImageMetadata = {}; 
let imageGenerationQueue = []; 
let isImageGenerationInProgress = false;

export function init(options) {
    toastManager = options.toastManager;
    renderStoryCallback = options.renderStory;
}

export function getMetadata() { return aiImageMetadata; }
export function setMetadata(data) { aiImageMetadata = data || {}; }
export function clearMetadata() { aiImageMetadata = {}; }

/**
 * Uses Gemini to read the full story and the selection, returning a 
 * context-aware visual prompt.
 */
async function refinePrompt(fullStory, selectedText, hiddenDetails, styleGuide) {
    const apiKey = localStorage.getItem('google_ai_api_key')?.trim();
    if (!apiKey) return selectedText; // Fallback to raw selection if no key

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const body = {
        contents: [{
            parts: [{
                text: `You are a visual director. 
                STORY CONTEXT: ${fullStory}
                STORY METADATA: ${hiddenDetails || 'No additional metadata'}
                STYLE GUIDE: ${styleGuide || 'None established yet'}
                SCENE TO ILLUSTRATE: ${selectedText}
                
                Task: Create a single-paragraph visual prompt for an image generator. 
                Describe the scene visually in detail, focusing on composition, subjects, and lighting.
                Include quality-enhancing keywords like "detailed, masterpiece, sharp focus, cinematic lighting".
                Ensure character appearances and settings are consistent with the story context and STYLE GUIDE.
                If a STYLE GUIDE exists, prioritize its description of characters and art style to maintain continuity.
                
                Output ONLY the refined prompt text without any labels, quotes, or conversational filler. 
                Keep it under 1000 characters.`
            }]
        }]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            if (response.status === 429) {
                toastManager.show('AI limit reached. Using basic prompt.', 'info');
            }
            const errBody = await response.json().catch(() => ({}));
            throw new Error(`Gemini API error ${response.status}: ${JSON.stringify(errBody)}`);
        }

        const data = await response.json();
        const refined = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return refined || selectedText;
    } catch (err) {
        console.error("[AI-GEN] Prompt refinement failed:", err);
        return selectedText;
    }
}

/**
 * Uses Gemini to analyze the whole story and insert context-aware image tags.
 */
export async function illustrateStory(storyText, updateInputCallback, sessionImages, localImageUrls) {
    const apiKey = localStorage.getItem('google_ai_api_key')?.trim();
    if (!apiKey) {
        toastManager.show('Please set your Google AI API Key in the settings first.', 'error');
        return;
    }

    toastManager.show('The AI is reading your story to plan illustrations...', 'info');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const body = {
        contents: [{
            parts: [{
                text: `You are a book illustrator. 
                STORY: ${storyText}
                
                Task: Rewrite the story by inserting image tags at natural breaks.
                Each tag must look exactly like this: [IMAGE: a detailed visual description of the scene]
                
                Guidelines:
                1. Keep the original story text exactly as is.
                2. Insert a tag every few paragraphs.
                3. Maintain character and setting consistency.
                4. Each visual description should be a detailed paragraph (under 1000 characters).
                5. Include quality keywords: "detailed, masterpiece, sharp focus, cinematic lighting".
                
                Output ONLY the rewritten story with tags.`
            }]
        }]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            if (response.status === 429) {
                toastManager.show('AI limit reached. Please try again later.', 'error');
            }
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        let illustratedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (illustratedText) {
            // Process the new prompts into unique file identifiers
            const imageRegex = /\[IMAGE:\s*(.*?)\s*\]/g;
            illustratedText = illustratedText.replace(imageRegex, (match, promptText) => {
                const fileName = `ai-gen-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
                aiImageMetadata[fileName] = { prompt: promptText.trim(), status: 'pending' };
                imageGenerationQueue.push(fileName);
                return `[IMAGE: ${fileName}]`;
            });

            updateInputCallback(illustratedText);
            processQueue(sessionImages, localImageUrls);
            toastManager.show('Illustration tags added! Images are now generating.', 'success');
        }
    } catch (err) {
        console.error("[AI-GEN] Full story illustration failed:", err);
        toastManager.show('Failed to illustrate story.', 'error');
    }
}

/**
 * The context-aware Magic Image logic.
 */
export async function insertMagicImage(storyText, start, end, hiddenDetails, updateInputCallback, sessionImages, localImageUrls) {
    const selectedText = storyText.substring(start, end).trim();
    
    if (!selectedText) {
        toastManager.show('Highlight some text to illustrate!', 'info');
        return;
    }

    toastManager.show('Refining image prompt...', 'info');

    // Find the first successful prompt to act as a Visual Style Guide for continuity
    const styleGuide = Object.values(aiImageMetadata).find(m => m.status === 'success')?.prompt;

    // Get the refined, context-aware prompt
    const visualPrompt = await refinePrompt(storyText, selectedText, hiddenDetails, styleGuide);

    const fileName = `ai-gen-${Date.now()}.png`;
    
    // Create the record
    aiImageMetadata[fileName] = { 
        prompt: visualPrompt, 
        status: 'pending' 
    };

    // Update the story text immediately with the tag
    const before = storyText.substring(0, end);
    const after = storyText.substring(end);
    updateInputCallback(`${before}\n\n[IMAGE: ${fileName}]\n\n${after}`);
    
    // Add to queue and start processing
    imageGenerationQueue.push(fileName);
    renderStoryCallback();
    processQueue(sessionImages, localImageUrls);
    
    toastManager.show('Generating your image...', 'info');
}

/**
 * Verification logic for the API Key
 */
export async function testGeminiConnection(apiKey, statusEl) {
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) return;
    if (statusEl) statusEl.textContent = '⏳';
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${trimmedKey}`;
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            // Log available models to help debug the 404 errors
            const modelNames = data.models?.map(m => m.name.replace('models/', '')) || [];
            console.log("[AI-GEN] Gemini Key Valid. Available models:", modelNames);
            if (statusEl) statusEl.textContent = '✅';
        } else {
            const errData = await response.json().catch(() => ({}));
            console.error("[AI-GEN] Gemini Connection Test Failed:", response.status, errData);
            if (statusEl) statusEl.textContent = '❌';
        }
    } catch (e) { console.error("[AI-GEN] Gemini Connection Error:", e); if (statusEl) statusEl.textContent = '❌'; }
}

/**
 * Simple, direct fetch from Pollinations.
 */
async function generateAiImage(fileName, sessionImages, localImageUrls) {
    const metadata = aiImageMetadata[fileName];
    if (!metadata) return;

    metadata.status = 'generating';
    renderStoryCallback();

    const encodedPrompt = encodeURIComponent(metadata.prompt);
    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true`;
    
    console.log(`[AI-GEN] Requesting generation: ${url}`);

    try {
        sessionImages[fileName] = url;
        localImageUrls[fileName] = url;

        // Reverting to the simple warm-up delay that was working for the user previously
        await new Promise(r => setTimeout(r, 2000));
        metadata.status = 'success';
    } catch (err) {
        console.error(`[AI-GEN] Generation failed:`, err);
        metadata.status = 'failed';
    } finally {
        renderStoryCallback();
    }
}

/**
 * Resumes generation for any images that are still in 'pending' or 'failed' status.
 */
export function resumeQueue(sessionImages, localImageUrls) {
    Object.keys(aiImageMetadata).forEach(fileName => {
        const status = aiImageMetadata[fileName].status;
        if (status === 'pending' || status === 'failed') {
            if (!imageGenerationQueue.includes(fileName)) {
                imageGenerationQueue.push(fileName);
            }
        }
    });
    processQueue(sessionImages, localImageUrls);
}

/**
 * Manually trigger a retry for a specific image.
 */
export function retryGeneration(fileName, sessionImages, localImageUrls) {
    const metadata = aiImageMetadata[fileName];
    if (!metadata) return;

    metadata.status = 'pending';
    if (!imageGenerationQueue.includes(fileName)) {
        imageGenerationQueue.push(fileName);
    }
    renderStoryCallback();
    processQueue(sessionImages, localImageUrls);
}

/**
 * Sequential queue processing to avoid overwhelming the browser/API.
 */
async function processQueue(sessionImages, localImageUrls) {
    if (isImageGenerationInProgress || imageGenerationQueue.length === 0) return;
    
    isImageGenerationInProgress = true;
    console.log(`[AI-GEN] Queue started. Items to process: ${imageGenerationQueue.length}`);

    try {
        while (imageGenerationQueue.length > 0) {
            const fileName = imageGenerationQueue.shift();
            console.log(`[AI-GEN] Processing item: ${fileName}. Remaining: ${imageGenerationQueue.length}`);
            
            await generateAiImage(fileName, sessionImages, localImageUrls);
            
            // Check if the last one failed; if so, take a longer breather (5s) 
            // to allow the Pollinations server to recover.
            const wasSuccess = aiImageMetadata[fileName]?.status === 'success';
            const delay = wasSuccess ? 1000 : 5000;
            console.log(`[AI-GEN] Waiting ${delay}ms before next request...`);
            await new Promise(r => setTimeout(r, delay));
        }
    } finally {
        isImageGenerationInProgress = false;
        console.log(`[AI-GEN] Queue processing finished.`);
    }
}