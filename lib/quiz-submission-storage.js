const crypto = require('crypto');
const { list } = require('@vercel/blob');
const { setTimeout: delay } = require('node:timers/promises');
const READ_ATTEMPTS = 3;
const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const transientCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
function requestContext(req, quizId) {
    const header = req.headers?.['x-vercel-id'] || req.headers?.['x-request-id'];
    return {requestId:typeof header === 'string' ? header.slice(0, 200) : crypto.randomUUID(),
        quizId:typeof quizId === 'string' && /^custom-[a-f0-9]{32}$/.test(quizId) ? quizId : null,
        action:['start','submit','state','advance','report','correct','review','recording-save','recording-load','recording-review'].includes(req.body?.action) ? req.body.action : 'unknown'};
}
function storageStatus(error) {
    return error.storageStatus ?? error.statusCode ?? error.response?.status ?? ({
        BlobAccessError:403, BlobNotFoundError:404, BlobStoreNotFoundError:404,
        BlobServiceRateLimited:429, BlobServiceNotAvailable:503
    })[error.constructor?.name] ?? null;
}
function failureDetails(error, context, operation) {
    // Do not log cookies, tokens, record URLs, student identities, or answer content.
    return {...context, operation:error.operation || operation, storageStatus:storageStatus(error),
        storageRequestId:error.storageRequestId || null, attempts:error.attempts || 1,
        errorType:error.name && error.name !== 'Error' ? error.name : error.constructor?.name || 'Error',
        errorCode:error.cause?.code || error.code || null};
}
async function readRecordText(url, context) {
    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
        let response;
        const signal = AbortSignal.timeout(5000);
        try {
            response = await fetch(url, {cache:'no-store', signal});
            if (!response.ok) {
                // Release the failed response before opening another connection.
                try { await response.body?.cancel(); } catch (_) {}
                throw new Error('A quiz record could not be read.');
            }
            return await response.text();
        } catch (error) {
            error.operation = 'read-record';
            error.storageStatus = response?.status ?? null;
            error.storageRequestId = response?.headers?.get('x-vercel-id') || response?.headers?.get('x-request-id') || null;
            error.attempts = attempt;
            const networkFailure = transientCodes.has(error.cause?.code || error.code)
                || signal.aborted || error.name === 'TimeoutError'
                || (error.name === 'TypeError' && ['fetch failed', 'terminated'].includes(error.message));
            const retryable = response && !response.ok ? transientStatuses.has(response.status) : networkFailure;
            if (!retryable || attempt === READ_ATTEMPTS) throw error;
            console.warn('Quiz storage read retry:', failureDetails(error, context, 'read-record'));
            await delay(150 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
        }
    }
}
function createStorage(quizId) {
const PREFIX = 'quiz-submissions/'+quizId+'/';
function key() {
    const secret = process.env.QUIZ_STORAGE_SECRET || process.env.VOCABULARY_PAGE_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret || !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Quiz storage is not configured.');
    return crypto.createHash('sha256').update('penina-quiz-v1:' + secret).digest();
}
function encrypt(record) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(PREFIX));
    const data = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function decrypt(raw) {
    const item = JSON.parse(raw);
    if (item.v !== 1) throw new Error('Unsupported quiz record.');
    const cipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(item.iv, 'base64'));
    cipher.setAAD(Buffer.from(PREFIX)); cipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(item.data, 'base64')), cipher.final()]).toString('utf8'));
}
async function readRecords(prefix, context) {
    let cursor; const records = [];
    do {
        let result;
        try {
            // The Blob SDK already retries transient list failures; do not multiply its retry budget.
            result = await list({ prefix, cursor, limit: 1000 });
        } catch (error) { error.operation = 'list-records'; throw error; }
        for (let i = 0; i < result.blobs.length; i += 20) {
            records.push(...await Promise.all(result.blobs.slice(i, i + 20).map(async blob => {
                const raw = await readRecordText(blob.url, context);
                // A malformed or undecryptable record is not a temporary network failure.
                try { return decrypt(raw); }
                catch (error) { error.operation = 'decrypt-record'; error.storageStatus = 200; throw error; }
            })));
        }
        cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return records;
}
return {key,encrypt,decrypt,readRecords};
}
module.exports={createStorage,requestContext,failureDetails};
