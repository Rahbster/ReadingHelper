let toastManager;
let renderStoryCallback;
let openNavCallback;

let aiImageMetadata = {}; 
let imageGenerationQueue = []; 
let preferredImageModel = 'gemini-1.5-flash'; // Default fallback
let preferredTextModel = 'gemini-1.5-flash'; // Default fallback
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
            // Log all models to help debug 404s
            const availableModels = data.models?.map(m => m.name.replace('models/', '')) || [];
            console.log('[AI-GEN] Available Models:', availableModels);
            
            // Detect the best available models from your specific list
            const hasFlash25 = availableModels.includes('gemini-2.5-flash');
            const hasFlash25Image = availableModels.includes('gemini-2.5-flash-image');
            const hasFlash20 = availableModels.includes('gemini-2.0-flash') || availableModels.includes('gemini-2.0-flash-001') || availableModels.includes('gemini-2.0-flash-exp');
            const hasFlash20Lite = availableModels.includes('gemini-2.0-flash-lite');
            const hasFlashLatest = availableModels.includes('gemini-flash-latest');
            const hasProLatest = availableModels.includes('gemini-pro-latest');
            const hasFlash31Image = availableModels.includes('gemini-3.1-flash-image-preview');
            const hasFlash30Image = availableModels.includes('gemini-3-pro-image-preview');
            const hasImagen4Fast = availableModels.includes('imagen-4.0-fast-generate-001');
            const hasImagen4Ultra = availableModels.includes('imagen-4.0-ultra-generate-001');
            const hasImagen4 = availableModels.includes('imagen-4.0-generate-001');
            
            // Text Model Selection: Prioritize performance and known availability
            if (hasFlash25) preferredTextModel = 'gemini-2.5-flash';
            else if (hasFlash20) preferredTextModel = availableModels.includes('gemini-2.0-flash') ? 'gemini-2.0-flash' : (availableModels.includes('gemini-2.0-flash-001') ? 'gemini-2.0-flash-001' : 'gemini-2.0-flash-exp');
            else if (hasFlashLatest) preferredTextModel = 'gemini-flash-latest';
            else preferredTextModel = availableModels.includes('gemini-1.5-flash') ? 'gemini-1.5-flash' : 'gemini-flash-latest'; // Fallback to 1.5 or latest if nothing else
            
            // For images, we need a model that supports the IMAGE modality and has active quota.
            // Prioritize Imagen models first, as they are dedicated image generators.
            if (hasImagen4Fast) {
                preferredImageModel = 'imagen-4.0-fast-generate-001';
            } else if (hasImagen4Ultra) {
                preferredImageModel = 'imagen-4.0-ultra-generate-001';
            } else if (hasImagen4) {
                preferredImageModel = 'imagen-4.0-generate-001';
            } else if (hasFlash20) {
                preferredImageModel = availableModels.includes('gemini-2.0-flash') ? 'gemini-2.0-flash' : (availableModels.includes('gemini-2.0-flash-001') ? 'gemini-2.0-flash-001' : 'gemini-2.0-flash-exp');
            } else if (hasFlash20Lite) {
                preferredImageModel = 'gemini-2.0-flash-lite';
            } else if (hasFlash30Image) { // Fallback to Gemini image previews if Imagen not available
                preferredImageModel = 'gemini-3-pro-image-preview';
            } else if (hasFlash31Image) {
                preferredImageModel = 'gemini-3.1-flash-image-preview';
            } else if (hasFlash25Image) {
                preferredImageModel = 'gemini-2.5-flash-image';
            } else if (hasProLatest) {
                preferredImageModel = 'gemini-pro-latest';
            } else {
                preferredImageModel = availableModels.includes('gemini-flash-latest') ? 'gemini-flash-latest' : (availableModels.includes('gemini-flash-lite-latest') ? 'gemini-flash-lite-latest' : preferredTextModel);
            }

            console.log(`[AI-GEN] Selected models -> Text: ${preferredTextModel}, Image: ${preferredImageModel}`);
            
            if (statusEl) {
                statusEl.textContent = '✅';
                statusEl.title = `Key is valid. Using ${preferredTextModel} and ${preferredImageModel}.`;
            }
            toastManager.show('Connection successful!', 'success');
            if (!hasFlash20 && !hasFlash25 && !hasFlashLatest && !hasImagen4Fast) console.warn('Warning: No standard Gemini Flash or Imagen models found in your project.');
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
export async function illustrateStory(storyText, updateInputCallback, sessionImages, localImageUrls) {
    const apiKey = localStorage.getItem('google_ai_api_key');
    if (!apiKey) {
        toastManager.show('Please enter your Google AI API Key in Settings.', 'error', 6000);
        openNavCallback();
        return;
    }

    toastManager.show('Gemini is illustrating your story...', 'info', 5000);

    try {
        // Optimization: We use the same model but tell it to keep the text 
        // and just insert placeholders.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${preferredTextModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Read the following story and rewrite it, inserting exactly three [IMAGE: brief description] tags at significant scene breaks. Output ONLY the rewritten story text. Story: ${storyText}`
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

            console.log(`[AI-GEN] Story analyzed by Gemini. Found ${tagsToProcess.length} scenes to illustrate.`);

            for (const tagMatch of tagsToProcess) {
                const prompt = tagMatch[1].trim();
                const fileName = `ai-gen-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
                aiImageMetadata[fileName] = { prompt: prompt, status: 'pending' };
                finalStory = finalStory.replace(tagMatch[0], `[IMAGE: ${fileName}]`);
                imageGenerationQueue.push(fileName);
            }

            updateInputCallback(finalStory);
            renderStoryCallback();
            processQueue(sessionImages, localImageUrls);
            toastManager.show('Magic Illustrations added!', 'success');
        }
    } catch (error) {
        toastManager.show(`Illustration failed: ${error.message}`, 'error');
    }
}

/**
 * Inserts a single AI image tag based on selection.
 */
export async function insertMagicImage(storyText, start, end, updateInputCallback, sessionImages, localImageUrls) {
    const selectedText = storyText.substring(start, end).trim();
    if (!selectedText) {
        toastManager.show('Please highlight the scene you want to illustrate.', 'info');
        return;
    }

    // Optimization: Skip the extra text-generation API call and use the selected text 
    // directly as the image prompt. This saves quota and is much faster.
    const prompt = selectedText.length > 100 
        ? selectedText.substring(0, 97) + "..." 
        : selectedText;

    console.log(`[AI-GEN] Magic illustration requested for: "${prompt}"`);

    const fileName = `ai-gen-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
    aiImageMetadata[fileName] = { prompt: prompt, status: 'pending' };
    imageGenerationQueue.push(fileName);

    const before = storyText.substring(0, end);
    const after = storyText.substring(end);
    updateInputCallback(`${before}\n\n[IMAGE: ${fileName}]\n\n${after}`);
    
    renderStoryCallback();
    processQueue(sessionImages, localImageUrls);
    toastManager.show('Illustration added to queue.', 'success');
}

/**
 * Background image generation logic.
 */
async function generateAiImage(fileName, sessionImages, localImageUrls) {
    const metadata = aiImageMetadata[fileName];
    if (!metadata) return;
    const apiKey = localStorage.getItem('google_ai_api_key');
    if (!apiKey) throw new Error("API Key missing");

    console.log(`[AI-GEN] Starting image generation for: "${metadata.prompt}" (File: ${fileName})`);
    
    // Sanitize prompt: Certain words like "Cockapoo" often trigger false-positive 403 safety blocks.
    let safePrompt = metadata.prompt
        .replace(/cockapoo/gi, 'curly-haired dog')
        .replace(/basenji/gi, 'small short-haired dog');

    try {
        metadata.status = 'generating';
        renderStoryCallback();

        // Using the detected preferred model. v1beta is required for multimodal IMAGE output.
        // Note: Even for Imagen models, the :generateContent endpoint expects the "contents" schema.
        const requestBody = JSON.stringify({
            contents: [{ 
                parts: [{ text: `Generate a high-quality 1024x1024 storybook style digital illustration of the following scene: ${safePrompt}. Output ONLY the image data.` }] 
            }],
            generationConfig: { 
                responseModalities: ["IMAGE"],
                candidateCount: 1 
            }
        });

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${preferredImageModel}:generateContent?key=${apiKey}`, { // Keep generateContent for now
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody
        });
        
        const data = await response.json();
        console.log(`[AI-GEN] API Response Status for ${fileName}:`, response.status);

        // Debugging: If 200 but no image, check if the model returned text or a safety reason instead.
        const textResponse = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
        const finishReason = data.candidates?.[0]?.finishReason;

        if (finishReason === 'SAFETY') throw new Error("Safety filters blocked the generation of this specific image.");
        if (textResponse && !data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)) {
            console.warn(`[AI-GEN] Model ${preferredImageModel} returned text instead of image: "${textResponse}"`);
            throw new Error("Model provided a text description but did not generate the actual image.");
        }

        const base64Data = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
        if (!base64Data) throw new Error("No image data returned.");

        if (response.status === 403) {
            throw new Error("Gemini Safety Filter blocked this image.");
        }
        if (response.status === 404) {
            throw new Error(`Model ${preferredImageModel} not found or doesn't support image modality.`);
        }
        if (response.status === 429) {
            // Log the full error to see if it's "RATE_LIMIT_EXCEEDED" or "DAILY_QUOTA_EXCEEDED"
            console.error('[AI-GEN] Detailed Quota Error:', JSON.stringify(data.error, null, 2));
            
            const reason = data.error?.status || 'UNKNOWN_LIMIT';
            const retryInfo = data.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
            const delay = retryInfo?.retryDelay || "60s";
            
            metadata.errorCode = 429;
            throw new Error(`Quota exceeded (${reason}). Wait ${delay}.`);
        }
        if (!response.ok) throw new Error(data.error?.message || 'API Error');

        const dataUrl = `data:image/png;base64,${base64Data}`;
        sessionImages[fileName] = dataUrl;
        localImageUrls[fileName] = dataUrl;
        metadata.status = 'success';
        console.log(`[AI-GEN] Successfully generated image for ${fileName}`);
        renderStoryCallback();
    } catch (error) {
        console.error(`[AI-GEN] Failed generating ${fileName}:`, error.message);
        metadata.status = 'failed';
        metadata.errorMessage = error.message;
        renderStoryCallback();
    }
}

export async function processQueue(sessionImages, localImageUrls) {
    if (isImageGenerationInProgress || imageGenerationQueue.length === 0) return;
    console.log(`[AI-GEN] Processing queue. Items remaining: ${imageGenerationQueue.length}`);
    isImageGenerationInProgress = true;

    while (imageGenerationQueue.length > 0) {
        const fileName = imageGenerationQueue[0]; // Peek at the next item

        // Skip if already successfully generated
        if (aiImageMetadata[fileName]?.status === 'success') {
            imageGenerationQueue.shift();
            continue;
        }

        await generateAiImage(fileName, sessionImages, localImageUrls);
        
        const metadata = aiImageMetadata[fileName];
        if (metadata.status === 'success') {
            imageGenerationQueue.shift(); // Remove only on success
            // Respect the 15 RPM limit by waiting ~8s between generations
            await new Promise(r => setTimeout(r, 8000)); 
        } else if (metadata.errorCode === 429) {
            // Rate limit hit. Stop the queue for now and keep the item for retry.
            console.warn(`[AI-GEN] Queue paused due to usage limits.`);
            break; 
        } else {
            // Permanent failure or safety filter. Remove so we don't get stuck.
            imageGenerationQueue.shift();
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    console.log(`[AI-GEN] Queue empty. Generation process stopped.`);
    isImageGenerationInProgress = false;
}

/**
 * Scans metadata for any images that need to be generated and adds them to the queue.
 */
export function resumeQueue(sessionImages, localImageUrls) {
    const pending = Object.keys(aiImageMetadata).filter(key => 
        aiImageMetadata[key].status === 'pending' || aiImageMetadata[key].status === 'failed'
    );
    
    if (pending.length > 0) {
        console.log(`[AI-GEN] Resuming queue for ${pending.length} unfinished illustrations.`);
        pending.forEach(key => {
            if (!imageGenerationQueue.includes(key)) imageGenerationQueue.push(key);
        });
        processQueue(sessionImages, localImageUrls);
    }
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