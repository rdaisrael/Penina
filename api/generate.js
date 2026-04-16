const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function (req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    
    const { prompt, suppliedText } = req.body;

    try {
        // --- PATHWAY: Vocalization via Dicta ---
        if (suppliedText) {
            const dictaKey = process.env.DICTA_API_KEY;
            
            // Critical Check: If the key is missing, don't even try the request
            if (!dictaKey) {
                return res.status(500).json({ error: "Missing DICTA_API_KEY in Vercel Environment Variables." });
            }

            const dictaRes = await fetch("https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    task: "nakdan",
                    apiKey: dictaKey,
                    genre: "modern",
                    data: suppliedText.trim(),
                    useTokenization: true,
                    matchpartial: true
                })
            });

            // Audit: If Dicta says no, get the specific reason
            if (!dictaRes.ok) {
                const errorDetail = await dictaRes.text();
                return res.status(dictaRes.status).json({ 
                    error: `Dicta API Rejected (${dictaRes.status}): ${errorDetail}` 
                });
            }

            const dictaData = await dictaRes.json();
            
            // Reconstruct the Hebrew text from Dicta's token array
            let finalHebrew = "";
            for (const token of dictaData.data) {
                if (token.sep) {
                    finalHebrew += (token.nakdan && token.nakdan.word) ? token.nakdan.word : token.str;
                } else if (token.nakdan?.options?.length > 0) {
                    finalHebrew += token.nakdan.options[0].w.replace(/\|/g, ''); 
                } else {
                    finalHebrew += token.str;
                }
            }
            return res.status(200).json({ text: finalHebrew });
        }

        // --- PATHWAY: Generation via Gemini ---
        if (prompt) {
            const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            if (!googleKey) return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });

            const genAI = new GoogleGenerativeAI(googleKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(prompt);
            return res.status(200).json({ text: result.response.text() });
        }

        return res.status(400).json({ error: "No text or prompt provided." });

    } catch (error) {
        console.error("Backend Error:", error);
        return res.status(500).json({ error: error.message });
    }
};