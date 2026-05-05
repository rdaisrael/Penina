const { GoogleGenerativeAI } = require("@google/generative-ai");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(model, promptText, options = {}) {
    const retries = Number.isInteger(options.retries) ? options.retries : 2;
    const initialDelayMs = Number.isInteger(options.initialDelayMs) ? options.initialDelayMs : 900;
    const throttleMs = Number.isInteger(options.throttleMs) ? options.throttleMs : 350;

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            if (throttleMs > 0) {
                await sleep(throttleMs);
            }

            const result = await model.generateContent(promptText);

            if (!result || !result.response) {
                throw new Error("AI generated an empty response.");
            }

            const text = String(result.response.text() || "").trim();
            if (!text) {
                throw new Error("AI generated a blank response.");
            }

            return text;
        } catch (e) {
            lastError = e;
            const message = String(e && e.message ? e.message : e).toLowerCase();
            const retryable =
                message.includes("429") ||
                message.includes("quota") ||
                message.includes("rate") ||
                message.includes("resource exhausted") ||
                message.includes("timeout") ||
                message.includes("unavailable") ||
                message.includes("internal") ||
                message.includes("overloaded") ||
                message.includes("empty response") ||
                message.includes("blank response");

            if (attempt >= retries || !retryable) {
                throw e;
            }

            const backoffMs = initialDelayMs * Math.pow(2, attempt);
            await sleep(backoffMs);
        }
    }

    throw lastError || new Error("Unknown Gemini API error.");
}

module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const body = req.body || {};
    const promptText = typeof body.promptText === 'string' ? body.promptText.trim() : '';
    const prompts = Array.isArray(body.prompts)
        ? body.prompts.map(p => String(p || '').trim()).filter(Boolean)
        : [];

    if (!promptText && prompts.length === 0) {
        return res.status(400).json({ error: 'Missing promptText or prompts' });
    }

    const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!googleKey) return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });

    try {
        const genAI = new GoogleGenerativeAI(googleKey, { apiVersion: 'v1' });
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        if (prompts.length > 0) {
            const results = [];

            for (const prompt of prompts) {
                try {
                    const text = await generateWithRetry(model, prompt, {
                        retries: 2,
                        initialDelayMs: 900,
                        throttleMs: 350
                    });
                    results.push({ ok: true, text });
                } catch (e) {
                    const message = String(e && e.message ? e.message : e);
                    console.error("Gemini API Batch Item Error:", message);
                    results.push({ ok: false, error: message, text: "" });
                }
            }

            return res.status(200).json({ results });
        }

        const text = await generateWithRetry(model, promptText, {
            retries: 2,
            initialDelayMs: 900,
            throttleMs: 350
        });

        return res.status(200).json({ text });
    } catch (e) {
        console.error("Gemini API Error:", e.message);
        return res.status(500).json({ error: e.message });
    }
};