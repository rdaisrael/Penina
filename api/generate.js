const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    
    const { prompt, suppliedText, dictaGenre } = req.body;
    
    // Intercept "biblical" and route it to Dicta's "poetry" model 
    const targetGenre = dictaGenre === "biblical" ? "poetry" : dictaGenre;
    
    const validGenres = ["modern", "rabbinic", "poetry"];
    const genreToUse = validGenres.includes(targetGenre) ? targetGenre : "modern";

    // 1. Enforce payload size limit to protect quotas
    if (suppliedText && suppliedText.length > 10000) return res.status(413).json({ error: 'Payload too large' });

    try {
        let textToVowelize = suppliedText;

        if (prompt) {
            const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            if (!googleKey) return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });

            const genAI = new GoogleGenerativeAI(googleKey, { apiVersion: 'v1' });
            let result;
            
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
                result = await model.generateContent(prompt);
            } catch (apiError) {
                // 2. Intercept 503/529 errors and fallback to stable model
                if (apiError.status === 503 || apiError.status === 529 || apiError.message.includes('503') || apiError.message.includes('529')) {
                    const fallbackModel = genAI.getGenerativeModel({ model: "gemini-3-flash" }); 
                    result = await fallbackModel.generateContent(prompt);
                } else {
                    throw apiError; 
                }
            }
            
            // 3. Catch empty responses before Dicta fails
            if (!result || !result.response || !result.response.text()) {
                throw new Error("AI generated an empty response (likely blocked by safety filters).");
            }
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

        return res.status(400).json({ error: "No input provided." });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};