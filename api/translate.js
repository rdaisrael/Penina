const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(req.body.promptText);
        return res.status(200).json({ text: result.response.text().trim() });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};