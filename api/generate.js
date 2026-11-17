const { generateOpenAIText } = require("../lib/openai-text");
const reader = require("../lib/reader-response");
const { createDictaRequest, readDictaResponse } = require("../lib/dicta-nikkud");
const { createReaderResponse } = require("../lib/reader-stream");

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    if (req.body?.action === 'binyan-worksheet') return require('../lib/binyan-handler')(req, res);

    const { prompt, suppliedText, dictaGenre, dictaOptions, readerVocabulary, sourceText, storyLength } = req.body || {};

    const targetGenre = dictaGenre === "biblical" ? "poetry" : dictaGenre;
    const validGenres = ["modern", "rabbinic", "poetry"];
    const genreToUse = validGenres.includes(targetGenre) ? targetGenre : "modern";

    if (suppliedText && suppliedText.length > 10000) {
        return res.status(413).json({ error: 'Payload too large' });
    }

    const started = Date.now();
    let stage = 'generation';
    const output = createReaderResponse(req, res);
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
            output.progress(stage);
            if (readerVocabulary) {
                analysis = await reader.generateReaderAnalysis(prompt, readerVocabulary, sourceText, generateOpenAIText, storyLength, {
                    signal: output.signal,
                    onStage: value => {stage = value; output.progress(stage);},
                    onGeneration: attempt => console.info('Reader generation', attempt)
                });
                textToVowelize = analysis.text;
            } else {
                textToVowelize = await generateOpenAIText(prompt, {signal: output.signal});
            }
        }

        if (textToVowelize) {
            stage = 'dicta';
            output.progress(stage);
            const dictaKey = process.env.DICTA_API_KEY;
            if (!dictaKey) return output.send(500, { error: "Missing DICTA_API_KEY." });

            const dictaBody = createDictaRequest({
                text: String(textToVowelize).trim(),
                apiKey: dictaKey,
                genre: genreToUse,
                options: dictaOptions
            });
            const dictaRes = await fetch("https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: output.signal ? AbortSignal.any([output.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
                body: JSON.stringify(dictaBody)
            }).catch(error => {
                const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
                throw Object.assign(new Error(timedOut
                    ? 'The Hebrew vowel service took too long. Please try again.'
                    : 'The Hebrew vowel service is temporarily unavailable. Please try again.'), {
                    status: 503, code: timedOut ? 'DICTA_TIMEOUT' : 'DICTA_NETWORK'
                });
            });

            if (!dictaRes.ok) {
                // Match Binyan Builder: an upstream failure is an application
                // service error. A 502 can be replaced by an HTML gateway page.
                throw Object.assign(new Error('The Hebrew vowel service is temporarily unavailable. Please try again.'), {
                    status: 503, code: 'DICTA_HTTP', upstreamStatus: dictaRes.status
                });
            }

            const dictaData = await dictaRes.json().catch(error => {
                const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
                throw Object.assign(new Error(timedOut
                    ? 'The Hebrew vowel service took too long. Please try again.'
                    : 'The Hebrew vowel service returned an unreadable response. Please try again.'), {
                    status: 503, code: timedOut ? 'DICTA_TIMEOUT' : 'DICTA_RESPONSE'
                });
            });

            const result = readDictaResponse(dictaData, {
                includeAnalysis: dictaOptions?.addmorph === true
            });
            if (analysis) {
                stage = 'validation';
                result.readerResult = reader.buildResult(result.text, analysis, dictaData.data);
                result.text = result.readerResult.text;
            }
            return output.send(200, result);
        }

        return output.send(400, { error: "No input provided." });
    } catch (error) {
        const code = /^(DICTA|OPENAI)_[A-Z_]+$/.test(error.code || '') ? error.code : 'READER_FAILED';
        console.error('Reader request failed:', {stage, code, durationMs: Date.now() - started,
            ...(Number.isInteger(error.upstreamStatus) ? {upstreamStatus: error.upstreamStatus} : {})});
        return output.send(error.status === 503 ? 503 : 500, { error: error.message });
    } finally {
        output.dispose();
    }
};
