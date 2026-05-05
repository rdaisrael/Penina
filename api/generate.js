const { GoogleGenerativeAI } = require("@google/generative-ai");

const PRIMARY_GEMINI_MODEL = "gemini-2.5-flash";
const FALLBACK_GEMINI_MODEL = "gemini-1.5-pro-002";
const RETRYABLE_STATUSES = new Set([429, 500, 503, 529]);

function isRetryableGeminiError(error) {
    const status = Number(error && error.status);
    if (RETRYABLE_STATUSES.has(status)) return true;

    const message = String(error && error.message ? error.message : error || "").toLowerCase();
    return (
        message.includes("429") ||
        message.includes("500") ||
        message.includes("503") ||
        message.includes("529") ||
        message.includes("quota") ||
        message.includes("rate") ||
        message.includes("resource exhausted") ||
        message.includes("timeout") ||
        message.includes("unavailable") ||
        message.includes("internal") ||
        message.includes("overloaded") ||
        message.includes("empty response") ||
        message.includes("blank response")
    );
}

async function generateTextWithFallback(primaryModel, fallbackModel, prompt) {
    try {
        const result = await primaryModel.generateContent(prompt);
        const text = result && result.response ? String(result.response.text() || "").trim() : "";

        if (!text) {
            throw new Error("AI generated an empty response.");
        }

        return text;
    } catch (primaryError) {
        if (!isRetryableGeminiError(primaryError)) {
            throw primaryError;
        }

        const fallbackResult = await fallbackModel.generateContent(prompt);
        const fallbackText = fallbackResult && fallbackResult.response
            ? String(fallbackResult.response.text() || "").trim()
            : "";

        if (!fallbackText) {
            throw new Error("AI fallback generated an empty response.");
        }

        return fallbackText;
    }
}

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { prompt, suppliedText, dictaGenre } = req.body || {};

    const targetGenre = dictaGenre === "biblical" ? "poetry" : dictaGenre;
    const validGenres = ["modern", "rabbinic", "poetry"];
    const genreToUse = validGenres.includes(targetGenre) ? targetGenre : "modern";

    if (suppliedText && suppliedText.length > 10000) {
        return res.status(413).json({ error: 'Payload too large' });
    }

    try {
        let textToVowelize = suppliedText;

        if (prompt) {
            const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            if (!googleKey) return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });

            const genAI = new GoogleGenerativeAI(googleKey, { apiVersion: 'v1' });
            const primaryModel = genAI.getGenerativeModel({ model: PRIMARY_GEMINI_MODEL });
            const fallbackModel = genAI.getGenerativeModel({ model: FALLBACK_GEMINI_MODEL });

            textToVowelize = await generateTextWithFallback(primaryModel, fallbackModel, prompt);
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
                    data: String(textToVowelize).trim(),
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
                } else if (token.nakdan && token.nakdan.options && token.nakdan.options.length > 0) {
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