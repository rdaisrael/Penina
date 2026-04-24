const { GoogleGenerativeAI } = require("@google/generative-ai");

// Helper function to pause execution between retries
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to handle the 3x retry logic for a specific model
async function fetchWithRetry(genAI, modelName, promptText, maxRetries = 3) {
    const model = genAI.getGenerativeModel({ model: modelName });
    let attempts = 0;

    while (attempts < maxRetries) {
        try {
            const result = await model.generateContent(promptText);
            
            if (!result || !result.response) {
                throw new Error("AI generated an empty response.");
            }
            
            // If successful, return the text immediately
            return result.response.text().trim();

        } catch (e) {
            attempts++;
            console.error(`Gemini API Error with ${modelName} (Attempt ${attempts}):`, e.message);

            // Wait before retrying, increasing the wait time slightly each try
            if (attempts < maxRetries) {
                console.log(`Waiting to retry ${modelName}... (${attempts}/${maxRetries})`);
                await delay(2000 * attempts); // Wait 2s, then 4s, etc.
            } else {
                // If we've hit the max retries, throw the error so the fallback can catch it
                throw e; 
            }
        }
    }
}

module.exports = async function (req, res) {
    // 1. Basic Request Validation
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!req.body || !req.body.promptText) return res.status(400).json({ error: 'Missing promptText' });
    
    const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!googleKey) return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });

    // 2. AI Generation with Fallback Logic
    try {
        const genAI = new GoogleGenerativeAI(googleKey, { apiVersion: 'v1' });
        let finalOutputText;

        try {
            // First Priority: Try Gemini 2.5 Flash up to 3 times
            finalOutputText = await fetchWithRetry(genAI, "gemini-2.5-flash", req.body.promptText, 3);
            
        } catch (error25) {
            console.log("gemini-2.5-flash failed after 3 attempts. Falling back to gemini-2.0-flash...");
            
            try {
                // Second Priority: Try Gemini 2.0 Flash up to 3 times
                finalOutputText = await fetchWithRetry(genAI, "gemini-2.0-flash", req.body.promptText, 3);
                
            } catch (error20) {
                // If BOTH models failed 3 times each, fail gracefully back to the frontend
                return res.status(503).json({ 
                    error: "Both primary and fallback AI models are currently overloaded. Please try again in a few minutes." 
                });
            }
        }

        // 3. Return Success
        return res.status(200).json({ text: finalOutputText });

    } catch (e) {
        // Catch-all for SDK initialization errors, missing packages, etc.
        console.error("Critical Server Error:", e.message);
        return res.status(500).json({ error: "Internal Server Error during translation." });
    }
};