const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    
    // 1. Validate input exists
    if (!req.body || !req.body.promptText) return res.status(400).json({ error: 'Missing promptText' });
    
    // 2. Validate API key exists
    const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!googleKey) return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });

    try {
        const genAI = new GoogleGenerativeAI(googleKey, { apiVersion: 'v1' });
        let result;
        
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
            result = await model.generateContent(req.body.promptText);
        } catch (apiError) {
            // 3. Intercept 503/529 errors and fallback to stable model
            if (apiError.status === 503 || apiError.status === 529 || apiError.message.includes('503') || apiError.message.includes('529')) {
                const fallbackModel = genAI.getGenerativeModel({ model: "gemini-3-flash" }); 
                result = await fallbackModel.generateContent(req.body.promptText);
            } else {
                throw apiError; 
            }
        }
        
        if (!result || !result.response || !result.response.text()) {
            throw new Error("AI generated an empty response.");
        }

        return res.status(200).json({ text: result.response.text().trim() });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};