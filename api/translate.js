module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { promptText } = req.body;
        const GEMINI_KEY = process.env.GEMINI_API_KEY;

        if (!GEMINI_KEY) {
            return res.status(500).json({ error: 'Missing Gemini API Key for translation.' });
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { temperature: 0.1 } 
            })
        });

        const data = await response.json();
        
        if (!response.ok) return res.status(500).json({ error: 'Gemini Translation Error' });

        const translatedText = data.candidates[0].content.parts[0].text.trim();
        res.status(200).json({ text: translatedText });

    } catch (error) {
        console.error("Translate Error:", error);
        res.status(500).json({ error: 'Failed to translate text.' });
    }
}