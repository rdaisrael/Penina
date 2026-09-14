const { generateOpenAIText } = require("../lib/openai-text");
const reader = require("../lib/reader-response");
const { createDictaRequest, readDictaResponse } = require("../lib/dicta-nikkud");

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { prompt, suppliedText, dictaGenre, dictaOptions, readerVocabulary, sourceText } = req.body || {};

    const targetGenre = dictaGenre === "biblical" ? "poetry" : dictaGenre;
    const validGenres = ["modern", "rabbinic", "poetry"];
    const genreToUse = validGenres.includes(targetGenre) ? targetGenre : "modern";

    if (suppliedText && suppliedText.length > 10000) {
        return res.status(413).json({ error: 'Payload too large' });
    }

    try {
        let textToVowelize = suppliedText;
        let analysis;
        if (sourceText !== undefined && (typeof sourceText !== "string" || sourceText.length > 10000)) return res.status(400).json({error:"Invalid supplied text."});

        if (prompt) {
            if (typeof prompt !== 'string') {
                return res.status(400).json({ error: "Prompt must be text." });
            }
            if (prompt.length > 50000) {
                return res.status(413).json({ error: "Prompt too large." });
            }
            if (readerVocabulary) {
                const raw = await generateOpenAIText(reader.readerPrompt(prompt, readerVocabulary, sourceText), {
                    textFormat: reader.readerFormat, maxOutputTokens: 32000, timeoutMs: 60000
                });
                let parsed;
                try { parsed = JSON.parse(raw); } catch (_) { throw new Error("The reader analysis was incomplete. Please generate again."); }
                analysis = reader.validateAnalysis(parsed, readerVocabulary, sourceText);
                textToVowelize = analysis.text;
            } else {
                textToVowelize = await generateOpenAIText(prompt);
            }
        }

        if (textToVowelize) {
            const dictaKey = process.env.DICTA_API_KEY;
            if (!dictaKey) return res.status(500).json({ error: "Missing DICTA_API_KEY." });

            const dictaRes = await fetch("https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(createDictaRequest({
                    text: String(textToVowelize).trim(),
                    apiKey: dictaKey,
                    genre: genreToUse,
                    options: dictaOptions
                }))
            });

            if (!dictaRes.ok) {
                const errorDetail = await dictaRes.text();
                return res.status(dictaRes.status).json({ error: `Dicta API Rejected (${dictaRes.status}): ${errorDetail}` });
            }

            const dictaData = await dictaRes.json();

            const result = readDictaResponse(dictaData, {
                includeAnalysis: dictaOptions?.addmorph === true
            });
            if (analysis) result.readerResult = reader.buildResult(result.text, analysis);
            return res.status(200).json(result);
        }

        return res.status(400).json({ error: "No input provided." });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};