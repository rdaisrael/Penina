const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    
    const { prompt, suppliedText, dictaGenre } = req.body;
    const genreToUse = dictaGenre || "modern";

    try {
        let textToVowelize = suppliedText;

        if (prompt) {
            const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            if (!googleKey) return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });

            const genAI = new GoogleGenerativeAI(googleKey, { apiVersion: 'v1' });
          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const result = await model.generateContent(prompt);
            textToVowelize = result.response.text();
        }

        if (textToVowelize) {
            const dictaKey = process.env.DICTA_API_KEY;
            if (!dictaKey) return res.status(500).json({ error: "Missing DICTA_API_KEY." });

            const dictaRes = await fetch("https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    task: "nakdan",
                    apiKey: dictaKey,
                    genre: genreToUse,
                    data: textToVowelize.trim(),
                    useTokenization: true,
                    matchpartial: true
                })
            });

            if (!dictaRes.ok) {
                const errorDetail = await dictaRes.text();
                return res.status(dictaRes.status).json({ error: `Dicta API Rejected (${dictaRes.status}): ${errorDetail}` });
            }

            const dictaData = await dictaRes.json();
            
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

        return res.status(400).json({ error: "Invalid Request: No prompt or suppliedText provided." });
    } catch (error) {
        console.error("Backend Error:", error);
        return res.status(500).json({ error: error.message });
    }
};