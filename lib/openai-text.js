// Server-only Responses API adapter. Dicta remains responsible for vocalization.
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const PRIMARY_MODEL = 'gpt-5.6-terra';
const FALLBACK_MODEL = 'gpt-6-astra';
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

function failure(message, retryable = false) {
    return Object.assign(new Error(message), { retryable });
}

function readResponse(data) {
    if (data?.status !== 'completed') {
        throw failure('OpenAI did not complete the text. Please try a shorter request.');
    }
    const content = (data.output || [])
        .filter(item => item.type === 'message' && item.role === 'assistant')
        .flatMap(item => item.content || []);
    if (content.some(item => item.type === 'refusal')) {
        throw failure('OpenAI could not fulfill this request. Please revise the topic.');
    }
    const text = content.filter(item => item.type === 'output_text')
        .map(item => item.text || '').join('\n').trim();
    if (!text) throw failure('OpenAI returned no text. Please try again.', true);
    return text;
}

async function generateOpenAIText(prompt, {
    env = process.env,
    fetchImpl = globalThis.fetch,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    textFormat,
    maxOutputTokens = 10000,
    timeoutMs = 35000
} = {}) {
    if (!env.OPENAI_API_KEY) throw failure('Missing OPENAI_API_KEY. Configure it on the server.');
    const primary = env.OPENAI_READER_MODEL || PRIMARY_MODEL;
    const fallback = env.OPENAI_READER_FALLBACK_MODEL === undefined
        ? FALLBACK_MODEL : env.OPENAI_READER_FALLBACK_MODEL;
    const models = [primary, primary];
    if (fallback && fallback !== primary) models.push(fallback);
    for (let attempt = 0; attempt < models.length; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(RESPONSES_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: models[attempt], input: prompt,
                    reasoning: { effort: 'low' },
                    max_output_tokens: maxOutputTokens, store: false,
                    ...(textFormat ? {text: {format: textFormat}} : {})
                })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                if (data.error?.code === 'insufficient_quota') {
                    throw failure('OpenAI API quota is exhausted. Check the project billing and limits.');
                }
                if (response.status === 401 || response.status === 403) {
                    throw failure('OpenAI authentication or access failed. Check the server API key and model permissions.');
                }
                throw failure(`OpenAI request failed (HTTP ${response.status}). Please try again or check the server configuration.`, RETRYABLE.has(response.status));
            }
            return readResponse(await response.json());
        } catch (error) {
            // Never return raw provider/network errors, which may contain request details.
            const safeError = typeof error.retryable === 'boolean' ? error
                : failure('The AI service is temporarily unavailable. Please try again.', true);
            if (!safeError.retryable || attempt === models.length - 1) throw safeError;
        } finally {
            clearTimeout(timeout);
        }
        await wait(1000 * (attempt + 1));
    }
}

module.exports = { generateOpenAIText, readResponse };
