const { GoogleGenerativeAI } = require("@google/generative-ai");

const PRIMARY_GEMINI_MODEL = process.env.GEMINI_PRIMARY_MODEL || "gemini-2.5-flash";
const FALLBACK_GEMINI_MODEL = process.env.GEMINI_FALLBACK_MODEL || "";
const USE_FALLBACK_MODEL = String(process.env.GEMINI_USE_FALLBACK || "false").toLowerCase() === "true";

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

const DEFAULT_RETRIES = 1;
const DEFAULT_INITIAL_DELAY_MS = 600;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_BATCH_CONCURRENCY = 3;
const DEFAULT_MAX_BATCH_CONCURRENCY = 8;
const DEFAULT_MAX_PROMPTS = 150;
const DEFAULT_MAX_PROMPT_CHARS = 6000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function getErrorStatus(error) {
    const status = Number(
        error?.status ||
        error?.code ||
        error?.response?.status ||
        error?.response?.statusCode ||
        0
    );

    return Number.isFinite(status) ? status : 0;
}

function getErrorMessage(error) {
    return String(
        error?.message ||
        error?.error?.message ||
        error?.response?.data?.error?.message ||
        error ||
        "Unknown Gemini error"
    );
}

function isRetryableGeminiError(error) {
    const status = getErrorStatus(error);
    if (RETRYABLE_STATUSES.has(status)) return true;

    const message = getErrorMessage(error).toLowerCase();

    return (
        message.includes("429") ||
        message.includes("500") ||
        message.includes("502") ||
        message.includes("503") ||
        message.includes("504") ||
        message.includes("529") ||
        message.includes("quota") ||
        message.includes("rate") ||
        message.includes("resource exhausted") ||
        message.includes("timeout") ||
        message.includes("deadline") ||
        message.includes("unavailable") ||
        message.includes("internal") ||
        message.includes("overloaded") ||
        message.includes("temporarily") ||
        message.includes("empty response") ||
        message.includes("blank response")
    );
}

function buildBackoffMs(initialDelayMs, attempt) {
    const jitter = Math.floor(Math.random() * 250);
    return initialDelayMs * Math.pow(2, attempt) + jitter;
}

function sanitizePrompt(prompt) {
    return String(prompt || "").trim().slice(0, DEFAULT_MAX_PROMPT_CHARS);
}

function extractText(result) {
    if (!result || !result.response) return "";

    try {
        return String(result.response.text() || "").trim();
    } catch (_) {
        return "";
    }
}

function withTimeout(promise, timeoutMs) {
    let timeoutHandle;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Gemini request timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutHandle);
    });
}

async function generateTextOnce(model, promptText, timeoutMs) {
    const result = await withTimeout(model.generateContent(promptText), timeoutMs);
    const text = extractText(result);

    if (!text) {
        const finishReason = result?.response?.candidates?.[0]?.finishReason;
        const reason = finishReason ? ` Finish reason: ${finishReason}.` : "";
        throw new Error(`AI generated a blank response.${reason}`);
    }

    return text;
}

async function generateTextWithRetry(primaryModel, fallbackModel, promptText, options = {}) {
    const retries = clampInteger(options.retries, DEFAULT_RETRIES, 0, 4);
    const initialDelayMs = clampInteger(options.initialDelayMs, DEFAULT_INITIAL_DELAY_MS, 100, 10000);
    const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 3000, 60000);

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await generateTextOnce(primaryModel, promptText, timeoutMs);
        } catch (error) {
            lastError = error;

            if (!isRetryableGeminiError(error)) throw error;

            if (attempt < retries) {
                await sleep(buildBackoffMs(initialDelayMs, attempt));
            }
        }
    }

    if (USE_FALLBACK_MODEL && fallbackModel) {
        try {
            return await generateTextOnce(fallbackModel, promptText, timeoutMs);
        } catch (fallbackError) {
            lastError = fallbackError;
        }
    }

    throw lastError || new Error("Gemini request failed.");
}

async function translatePrompt(primaryModel, fallbackModel, promptText, options = {}) {
    const cleanedPrompt = sanitizePrompt(promptText);

    if (!cleanedPrompt) {
        return { ok: false, error: "Blank prompt.", text: "" };
    }

    try {
        const text = await generateTextWithRetry(primaryModel, fallbackModel, cleanedPrompt, options);
        return { ok: true, text };
    } catch (error) {
        return { ok: false, error: getErrorMessage(error), text: "" };
    }
}

async function translateBatch(primaryModel, fallbackModel, prompts, options = {}) {
    const concurrency = clampInteger(
        options.concurrency,
        DEFAULT_BATCH_CONCURRENCY,
        1,
        DEFAULT_MAX_BATCH_CONCURRENCY
    );

    const results = new Array(prompts.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;

            if (index >= prompts.length) return;

            results[index] = await translatePrompt(
                primaryModel,
                fallbackModel,
                prompts[index],
                options
            );
        }
    }

    const workerCount = Math.min(concurrency, prompts.length);
    const workers = [];

    for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    return results;
}

module.exports = async function (req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const body = req.body || {};
    const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!googleKey) {
        return res.status(500).json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." });
    }

    const promptText = typeof body.promptText === "string" ? sanitizePrompt(body.promptText) : "";
    const prompts = Array.isArray(body.prompts)
        ? body.prompts.map((prompt) => sanitizePrompt(prompt))
        : [];

    if (!promptText && prompts.length === 0) {
        return res.status(400).json({ error: "Missing promptText or prompts" });
    }

    if (prompts.length > DEFAULT_MAX_PROMPTS) {
        return res.status(413).json({
            error: `Too many prompts. Maximum is ${DEFAULT_MAX_PROMPTS}.`
        });
    }

    try {
        const genAI = new GoogleGenerativeAI(googleKey, { apiVersion: "v1" });
        const primaryModel = genAI.getGenerativeModel({ model: PRIMARY_GEMINI_MODEL });
        const fallbackModel = USE_FALLBACK_MODEL && FALLBACK_GEMINI_MODEL
            ? genAI.getGenerativeModel({ model: FALLBACK_GEMINI_MODEL })
            : null;

        const options = {
            retries: clampInteger(process.env.GEMINI_RETRIES, DEFAULT_RETRIES, 0, 4),
            initialDelayMs: clampInteger(
                process.env.GEMINI_INITIAL_DELAY_MS,
                DEFAULT_INITIAL_DELAY_MS,
                100,
                10000
            ),
            timeoutMs: clampInteger(process.env.GEMINI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 3000, 60000),
            concurrency: clampInteger(
                process.env.GEMINI_BATCH_CONCURRENCY,
                DEFAULT_BATCH_CONCURRENCY,
                1,
                DEFAULT_MAX_BATCH_CONCURRENCY
            )
        };

        if (prompts.length > 0) {
            const results = await translateBatch(primaryModel, fallbackModel, prompts, options);
            const okCount = results.filter((result) => result && result.ok).length;
            const failCount = results.length - okCount;
            const firstError = results.find((result) => result && !result.ok)?.error || "";

            if (failCount > 0) {
                console.error(
                    `Gemini batch translation: ${okCount}/${results.length} succeeded. First error: ${firstError}`
                );
            }

            return res.status(200).json({ results, okCount, failCount, firstError });
        }

        const singleResult = await translatePrompt(primaryModel, fallbackModel, promptText, options);

        if (!singleResult.ok) {
            return res.status(500).json({
                error: singleResult.error || "Translation failed."
            });
        }

        return res.status(200).json({ text: singleResult.text });
    } catch (error) {
        const status = getErrorStatus(error);
        const message = getErrorMessage(error);

        console.error("Gemini API Error:", message);

        return res
            .status(status && status >= 400 && status < 600 ? status : 500)
            .json({ error: message });
    }
};