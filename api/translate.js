const { generateOpenAIText } = require("../lib/openai-text");

const DEFAULT_BATCH_CONCURRENCY = 3;
const DEFAULT_MAX_BATCH_CONCURRENCY = 8;
const DEFAULT_MAX_PROMPTS = 150;
const DEFAULT_MAX_PROMPT_CHARS = 6000;

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function getErrorMessage(error) {
    return String(error?.message || "OpenAI request failed.");
}

function sanitizePrompt(prompt) {
    return String(prompt || "").trim().slice(0, DEFAULT_MAX_PROMPT_CHARS);
}

async function translatePrompt(promptText, options = {}) {
    const cleanedPrompt = sanitizePrompt(promptText);

    if (!cleanedPrompt) {
        return {
            ok: false,
            error: "Blank prompt.",
            text: ""
        };
    }

    try {
        const text = await generateOpenAIText(cleanedPrompt, options);

        return {
            ok: true,
            text
        };
    } catch (error) {
        return {
            ok: false,
            error: getErrorMessage(error),
            text: ""
        };
    }
}

async function translateBatch(prompts, options = {}) {
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

            if (index >= prompts.length) {
                return;
            }

            results[index] = await translatePrompt(
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
        return res.status(405).json({
            error: "Method Not Allowed"
        });
    }

    const body = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
        return res.status(500).json({
            error: "Missing OPENAI_API_KEY."
        });
    }

    const promptText =
        typeof body.promptText === "string"
            ? sanitizePrompt(body.promptText)
            : "";

    const prompts =
        Array.isArray(body.prompts)
            ? body.prompts.map((prompt) => sanitizePrompt(prompt))
            : [];

    if (!promptText && prompts.length === 0) {
        return res.status(400).json({
            error: "Missing promptText or prompts"
        });
    }

    if (prompts.length > DEFAULT_MAX_PROMPTS) {
        return res.status(413).json({
            error: `Too many prompts. Maximum is ${DEFAULT_MAX_PROMPTS}.`
        });
    }

    try {
        const options = {
            env: {
                ...process.env,
                OPENAI_READER_MODEL: process.env.OPENAI_VOCAB_MODEL || 'gpt-5.6-terra',
                // Vocabulary batches retain their previous no-fallback default.
                OPENAI_READER_FALLBACK_MODEL: process.env.OPENAI_VOCAB_FALLBACK_MODEL || ''
            },
            timeoutMs: clampInteger(process.env.OPENAI_VOCAB_TIMEOUT_MS, 20000, 3000, 60000),
            concurrency: clampInteger(process.env.OPENAI_BATCH_CONCURRENCY,
                DEFAULT_BATCH_CONCURRENCY, 1, DEFAULT_MAX_BATCH_CONCURRENCY)
        };

        if (prompts.length > 0) {
            const results = await translateBatch(
                prompts,
                options
            );

            const okCount = results.filter((result) => result && result.ok).length;
            const failCount = results.length - okCount;
            const firstError =
                results.find((result) => result && !result.ok)?.error || "";

            if (failCount > 0) {
                console.error(
                    `OpenAI batch translation: ${okCount}/${results.length} succeeded. First error: ${firstError}`
                );
            }

            return res.status(200).json({
                results,
                okCount,
                failCount,
                firstError
            });
        }

        const singleResult = await translatePrompt(
            promptText,
            options
        );

        if (!singleResult.ok) {
            return res.status(500).json({
                error: singleResult.error || "Translation failed."
            });
        }

        return res.status(200).json({
            text: singleResult.text
        });
    } catch (error) {
        const status = 500;
        const message = getErrorMessage(error);

        console.error("OpenAI API Error:", message);

        return res
            .status(status && status >= 400 && status < 600 ? status : 500)
            .json({
                error: message
            });
    }
};