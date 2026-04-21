const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    try {
        // Force v1 API version for 2026 stable compatibility
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY, { apiVersion: 'v1' });
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash" });
        
        let result;
        let retries = 3;
        let delay = 2000;

        while (retries > 0) {
            try {
                result = await model.generateContent(req.body.promptText);
                break;
            } catch (err) {
                if (err.message.includes("503") && retries > 1) {
                    retries--;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                } else {
                    throw err;
                }
            }
        }
        return res.status(200).json({ text: result.response.text().trim() });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};