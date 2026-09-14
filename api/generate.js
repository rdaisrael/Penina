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
                analysis = await reader.generateReaderAnalysis(prompt, readerVocabulary, sourceText, generateOpenAIText);
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
                signal: AbortSignal.timeout(25000),
                body: JSON.stringify(createDictaRequest({
                    text: String(textToVowelize).trim(),
                    apiKey: dictaKey,
                    genre: genreToUse,
                    options: dictaOptions
                }))
            });

            if (!dictaRes.ok) {
                return res.status(502).json({ error: "The Hebrew vowel service is temporarily unavailable. Please try again." });
            }

            const dictaData = await dictaRes.json();

            const result = readDictaResponse(dictaData, {
                includeAnalysis: dictaOptions?.addmorph === true
            });
            if (analysis) {
                result.readerResult = reader.buildResult(result.text, analysis, dictaData.data);
                result.text = result.readerResult.text;
            }
            return res.status(200).json(result);
        }

        return res.status(400).json({ error: "No input provided." });
    } catch (error) {
        const message = error.name === 'TimeoutError' || error.name === 'AbortError'
            ? 'The Hebrew vowel service took too long. Please try again.' : error.message;
        console.error('Reader request failed:', {name:error.name, message});
        return res.status(500).json({ error: message });
    }
};
