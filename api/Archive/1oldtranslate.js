const { GoogleGenerativeAI } = require("@google/generative-ai");

const PRIMARY_GEMINI_MODEL = "gemini-2.5-flash";
const FALLBACK_GEMINI_MODEL = "gemini-2.5-pro";
const RETRYABLE_STATUSES = new Set([429, 500, 503, 529]);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function generateOnce(model, promptText, throttleMs) {
    if (throttleMs > 0) {
        await sleep(throttleMs);
    }

    const result = await model.generateContent(promptText);
    const text = result && result.response ? String(result.response.text() || "").trim() : "";

    if (!text) {
        throw new Error("AI generated a blank response.");
    }

    return text;
}

async function generateWithFallback(primaryModel, fallbackModel, promptText, options = {}) {
    const retries = Number.isInteger(options.retries) ? options.retries : 2;
    const initialDelayMs = Number.isInteger(options.initialDelayMs) ? options.initialDelayMs : 900;
    const throttleMs = Number.isInteger(options.throttleMs) ? options.throttleMs : 350;

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await generateOnce(primaryModel, promptText, throttleMs);
        } catch (error) {
            lastError = error;

            if (!isRetryableGeminiError(error)) {
                throw error;
            }

            if (attempt < retries) {
                const backoffMs = initialDelayMs * Math.pow(2, attempt);
                await sleep(backoffMs);
            }
        }
    }

    try {
        return await generateOnce(fallbackModel, promptText, throttleMs);
    } catch (fallbackError) {
        throw fallbackError || lastError || new Error("Gemini fallback failed.");
    }
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
        const primaryModel = genAI.getGenerativeModel({ model: PRIMARY_GEMINI_MODEL });
        const fallbackModel = genAI.getGenerativeModel({ model: FALLBACK_GEMINI_MODEL });

        if (prompts.length > 0) {
            const results = [];

            for (const prompt of prompts) {
                try {
                    const text = await generateWithFallback(primaryModel, fallbackModel, prompt, {
                        retries: 2,
                        initialDelayMs: 900,
                        throttleMs: 350
                    });
                    results.push({ ok: true, text });
                } catch (error) {
                    const message = String(error && error.message ? error.message : error);
                    console.error("Gemini API Batch Item Error:", message);
                    results.push({ ok: false, error: message, text: "" });
                }
            }

            return res.status(200).json({ results });
        }

        const text = await generateWithFallback(primaryModel, fallbackModel, promptText, {
            retries: 2,
            initialDelayMs: 900,
            throttleMs: 350
        });

        return res.status(200).json({ text });
    } catch (error) {
        console.error("Gemini API Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
};