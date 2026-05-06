const { GoogleGenerativeAI } = require("@google/generative-ai");

const PRIMARY_GEMINI_MODEL = process.env.GEMINI_PRIMARY_MODEL || "gemini-2.5-flash";
const FALLBACK_GEMINI_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-pro";

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

const DEFAULT_SINGLE_RETRIES = 4;
const DEFAULT_BATCH_RETRIES = 4;
const DEFAULT_INITIAL_DELAY_MS = 1200;
const DEFAULT_THROTTLE_MS = 900;
const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_MAX_BATCH_SIZE = 25;
const DEFAULT_MAX_PROMPTS = 120;
const DEFAULT_MAX_PROMPT_CHARS = 4000;
const DEFAULT_PER_ITEM_RECOVERY_THROTTLE_MS = 2000;

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

    if (RETRYABLE_STATUSES.has(status)) {
        return true;
    }

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
    const exponential = initialDelayMs * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 350);
    return exponential + jitter;
}

function extractText(result) {
    if (!result || !result.response) {
        return "";
    }

    try {
        return String(result.response.text() || "").trim();
    } catch (_) {
        return "";
    }
}

async function generateOnce(model, promptText, options = {}) {
    const throttleMs = clampInteger(options.throttleMs, DEFAULT_THROTTLE_MS, 0, 15000);
    const generationConfig = options.generationConfig || undefined;

    if (throttleMs > 0) {
        await sleep(throttleMs);
    }

    const payload = generationConfig
        ? {
              contents: [
                  {
                      role: "user",
                      parts: [{ text: promptText }]
                  }
              ],
              generationConfig
          }
        : promptText;

    const result = await model.generateContent(payload);
    const text = extractText(result);

    if (!text) {
        const finishReason = result?.response?.candidates?.[0]?.finishReason;
        const reason = finishReason ? ` Finish reason: ${finishReason}.` : "";
        throw new Error(`AI generated a blank response.${reason}`);
    }

    return text;
}

async function generateWithFallback(primaryModel, fallbackModel, promptText, options = {}) {
    const retries = clampInteger(options.retries, DEFAULT_SINGLE_RETRIES, 0, 8);
    const initialDelayMs = clampInteger(options.initialDelayMs, DEFAULT_INITIAL_DELAY_MS, 100, 30000);
    const throttleMs = clampInteger(options.throttleMs, DEFAULT_THROTTLE_MS, 0, 15000);
    const generationConfig = options.generationConfig || undefined;

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await generateOnce(primaryModel, promptText, {
                throttleMs,
                generationConfig
            });
        } catch (error) {
            lastError = error;

            if (!isRetryableGeminiError(error)) {
                throw error;
            }

            if (attempt < retries) {
                await sleep(buildBackoffMs(initialDelayMs, attempt));
            }
        }
    }

    const fallbackRetries = Math.max(1, Math.floor(retries / 2));

    for (let attempt = 0; attempt <= fallbackRetries; attempt++) {
        try {
            return await generateOnce(fallbackModel, promptText, {
                throttleMs,
                generationConfig
            });
        } catch (error) {
            lastError = error;

            if (!isRetryableGeminiError(error)) {
                throw error;
            }

            if (attempt < fallbackRetries) {
                await sleep(buildBackoffMs(initialDelayMs, attempt));
            }
        }
    }

    throw lastError || new Error("Gemini fallback failed.");
}

function chunkArray(items, size) {
    const chunks = [];

    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }

    return chunks;
}

function sanitizePrompt(prompt) {
    return String(prompt || "").trim().slice(0, DEFAULT_MAX_PROMPT_CHARS);
}

function buildBatchPrompt(prompts) {
    const payload = prompts.map((prompt, index) => ({
        item_id: index,
        prompt
    }));

    return [
        "You are a careful translation assistant for Hebrew, Aramaic, and English vocabulary-sheet context.",
        "Process each input item independently.",
        "Follow the instruction inside each item's prompt as faithfully as possible.",
        "Return ONLY valid JSON.",
        "Do not use Markdown.",
        "Do not add commentary.",
        "The JSON must be an array with the same length and order as the input array.",
        "Each array element must be exactly: {\"item_id\": number, \"text\": string}.",
        "Never leave text blank. If a perfect translation is impossible, provide the best concise English rendering.",
        "Input array:",
        JSON.stringify(payload)
    ].join("\n");
}

function parseJsonArray(text) {
    const trimmed = String(text || "").trim();

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed;
        }
    } catch (_) {
        // Continue to bracket extraction below.
    }

    const firstBracket = trimmed.indexOf("[");
    const lastBracket = trimmed.lastIndexOf("]");

    if (firstBracket >= 0 && lastBracket > firstBracket) {
        try {
            const candidate = trimmed.slice(firstBracket, lastBracket + 1);
            const parsed = JSON.parse(candidate);

            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch (_) {
            // Fall through to final error.
        }
    }

    throw new Error("Gemini batch response was not a valid JSON array.");
}

function getSafeItemIndex(item, fallbackIndex, length) {
    const rawId = item?.item_id;
    const numericId = Number(rawId);

    if (
        Number.isInteger(numericId) &&
        numericId >= 0 &&
        numericId < length
    ) {
        return numericId;
    }

    if (fallbackIndex >= 0 && fallbackIndex < length) {
        return fallbackIndex;
    }

    return -1;
}

async function generateBatchChunk(primaryModel, fallbackModel, prompts, options = {}) {
    const batchPrompt = buildBatchPrompt(prompts);

    const text = await generateWithFallback(primaryModel, fallbackModel, batchPrompt, {
        retries: clampInteger(options.retries, DEFAULT_BATCH_RETRIES, 0, 8),
        initialDelayMs: clampInteger(options.initialDelayMs, DEFAULT_INITIAL_DELAY_MS, 100, 30000),
        throttleMs: clampInteger(options.throttleMs, DEFAULT_THROTTLE_MS, 0, 15000),
        generationConfig: {
            temperature: 0.2
        }
    });

    const parsed = parseJsonArray(text);

    const results = prompts.map(() => ({
        ok: false,
        error: "Missing batch result.",
        text: ""
    }));

    for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i] || {};
        const itemIndex = getSafeItemIndex(item, i, prompts.length);

        if (itemIndex < 0) {
            continue;
        }

        const itemText = String(item.text || "").trim();

        if (itemText) {
            results[itemIndex] = {
                ok: true,
                text: itemText
            };
        } else {
            results[itemIndex] = {
                ok: false,
                error: "Blank batch item response.",
                text: ""
            };
        }
    }

    return results;
}

async function recoverBatchSequentially(primaryModel, fallbackModel, prompts, existingResults, options = {}) {
    const recovered = existingResults.slice();

    for (let i = 0; i < recovered.length; i++) {
        if (recovered[i]?.ok) {
            continue;
        }

        try {
            const text = await generateWithFallback(primaryModel, fallbackModel, prompts[i], {
                retries: clampInteger(options.recoveryRetries, 3, 0, 8),
                initialDelayMs: clampInteger(options.initialDelayMs, DEFAULT_INITIAL_DELAY_MS, 100, 30000),
                throttleMs: clampInteger(
                    options.perItemThrottleMs,
                    DEFAULT_PER_ITEM_RECOVERY_THROTTLE_MS,
                    0,
                    15000
                )
            });

            recovered[i] = {
                ok: true,
                text
            };
        } catch (error) {
            recovered[i] = {
                ok: false,
                error: getErrorMessage(error),
                text: ""
            };
        }
    }

    return recovered;
}

async function generateBatchWithRecovery(primaryModel, fallbackModel, prompts, options = {}) {
    try {
        const batchResults = await generateBatchChunk(primaryModel, fallbackModel, prompts, options);

        if (batchResults.every((result) => result.ok)) {
            return batchResults;
        }

        return await recoverBatchSequentially(
            primaryModel,
            fallbackModel,
            prompts,
            batchResults,
            options
        );
    } catch (batchError) {
        console.error("Gemini API Batch Chunk Error:", getErrorMessage(batchError));

        const emptyResults = prompts.map(() => ({
            ok: false,
            error: getErrorMessage(batchError),
            text: ""
        }));

        return await recoverBatchSequentially(
            primaryModel,
            fallbackModel,
            prompts,
            emptyResults,
            options
        );
    }
}

module.exports = async function (req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method Not Allowed"
        });
    }

    const body = req.body || {};

    const promptText =
        typeof body.promptText === "string"
            ? sanitizePrompt(body.promptText)
            : "";

    const prompts =
        Array.isArray(body.prompts)
            ? body.prompts.map(sanitizePrompt).filter(Boolean)
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

    const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!googleKey) {
        return res.status(500).json({
            error: "Missing GOOGLE_GENERATIVE_AI_API_KEY."
        });
    }

    try {
        const genAI = new GoogleGenerativeAI(googleKey, {
            apiVersion: "v1"
        });

        const primaryModel = genAI.getGenerativeModel({
            model: PRIMARY_GEMINI_MODEL
        });

        const fallbackModel = genAI.getGenerativeModel({
            model: FALLBACK_GEMINI_MODEL
        });

        if (prompts.length > 0) {
            const batchSize = clampInteger(
                process.env.GEMINI_BATCH_SIZE,
                DEFAULT_BATCH_SIZE,
                1,
                DEFAULT_MAX_BATCH_SIZE
            );

            const chunks = chunkArray(prompts, batchSize);
            const results = [];

            for (const chunk of chunks) {
                const chunkResults = await generateBatchWithRecovery(
                    primaryModel,
                    fallbackModel,
                    chunk,
                    {
                        retries: clampInteger(
                            process.env.GEMINI_BATCH_RETRIES,
                            DEFAULT_BATCH_RETRIES,
                            0,
                            8
                        ),
                        recoveryRetries: clampInteger(
                            process.env.GEMINI_RECOVERY_RETRIES,
                            3,
                            0,
                            8
                        ),
                        initialDelayMs: clampInteger(
                            process.env.GEMINI_INITIAL_DELAY_MS,
                            DEFAULT_INITIAL_DELAY_MS,
                            100,
                            30000
                        ),
                        throttleMs: clampInteger(
                            process.env.GEMINI_BATCH_THROTTLE_MS,
                            DEFAULT_THROTTLE_MS,
                            0,
                            15000
                        ),
                        perItemThrottleMs: clampInteger(
                            process.env.GEMINI_PER_ITEM_THROTTLE_MS,
                            DEFAULT_PER_ITEM_RECOVERY_THROTTLE_MS,
                            0,
                            15000
                        )
                    }
                );

                results.push(...chunkResults);
            }

            const okCount = results.filter((result) => result.ok).length;
            const failCount = results.length - okCount;

            if (failCount > 0) {
                console.error(
                    `Gemini API Batch completed with ${failCount}/${results.length} failed item(s).`
                );
            }

            return res.status(200).json({
                results,
                okCount,
                failCount
            });
        }

        const text = await generateWithFallback(primaryModel, fallbackModel, promptText, {
            retries: clampInteger(
                process.env.GEMINI_SINGLE_RETRIES,
                DEFAULT_SINGLE_RETRIES,
                0,
                8
            ),
            initialDelayMs: clampInteger(
                process.env.GEMINI_INITIAL_DELAY_MS,
                DEFAULT_INITIAL_DELAY_MS,
                100,
                30000
            ),
            throttleMs: clampInteger(
                process.env.GEMINI_SINGLE_THROTTLE_MS,
                DEFAULT_THROTTLE_MS,
                0,
                15000
            )
        });

        return res.status(200).json({
            text
        });
    } catch (error) {
        const status = getErrorStatus(error);
        const message = getErrorMessage(error);

        console.error("Gemini API Error:", message);

        return res
            .status(status && status >= 400 && status < 600 ? status : 500)
            .json({
                error: message
            });
    }
};