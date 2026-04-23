const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    
    if (!req.body || !req.body.promptText) return res.status(400).json({ error: 'Missing promptText' });
    
    const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!googleKey) return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });

    try {
        const genAI = new GoogleGenerativeAI(googleKey, { apiVersion: 'v1' });
        
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(req.body.promptText);
        
        if (!result || !result.response) {
            throw new Error("AI generated an empty response.");
        }

        return res.status(200).json({ text: result.response.text().trim() });
    } catch (e) {
        console.error("Gemini API Error:", e.message);
        return res.status(500).json({ error: e.message });
    }
};