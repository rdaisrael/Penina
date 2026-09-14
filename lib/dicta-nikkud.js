'use strict';

// Only pass recognized boolean options. Other /api/generate callers retain their defaults.
const BOOLEAN_OPTIONS = ['keepqq', 'addmorph', 'keepmetagim', 'nodageshdefmem', 'patachma'];

function createDictaRequest({ text, apiKey, genre, options }) {
    const request = {
        task: 'nakdan', apiKey, genre, data: text,
        useTokenization: true, matchpartial: true
    };
    if (options != null) {
        if (typeof options !== 'object' || Array.isArray(options)) {
            throw new Error('Invalid Dicta options.');
        }
        for (const key of BOOLEAN_OPTIONS) {
            if (Object.prototype.hasOwnProperty.call(options, key)) {
                if (typeof options[key] !== 'boolean') {
                    throw new Error(`Dicta option ${key} must be a boolean.`);
                }
                request[key] = options[key];
            }
        }
    }
    return request;
}

function readDictaResponse(payload, { includeAnalysis = false } = {}) {
    if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) {
        throw new Error('Dicta returned no vocalized text. Please try again.');
    }
    const text = payload.data.map(token => {
        if (!token || typeof token.str !== 'string') {
            throw new Error('Dicta returned an invalid text token.');
        }
        if (token.sep) {
            return typeof token.nakdan?.word === 'string' ? token.nakdan.word : token.str;
        }
        const options = token.nakdan?.options;
        if (Array.isArray(options) && options.length > 0) {
            // Keep Dicta's existing first-choice ordering; preserve the alternatives below.
            if (typeof options[0]?.w !== 'string') {
                throw new Error('Dicta returned an invalid vocalization.');
            }
            return options[0].w.replace(/\|/g, '');
        }
        return token.str;
    }).join('');

    const result = { text };
    // Keep original token boundaries, alternatives, confidence and morphology together.
    // Consumers can use them for a future correction UI without another AI request.
    if (includeAnalysis) result.dictaTokens = payload.data;
    return result;
}

module.exports = { createDictaRequest, readDictaResponse };
