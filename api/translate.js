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
            // Target the stable 3.1 series 
            const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash" });
            result = await model.generateContent(req.body.promptText);
        } catch (apiError) {
            // Intercept 500, 503, 529, and 400 errors from unstable endpoints
            const status = apiError.status || (apiError.message && apiError.message.match(/\b(500|503|529|400)\b/) ? apiError.message.match(/\b(500|503|529|400)\b/)[0] : null);
            
            if (status) {
                // Fallback to the highly stable 1.5 workhorse
                const fallbackModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
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