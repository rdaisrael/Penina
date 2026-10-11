const crypto = require('crypto');
const { list, put } = require('@vercel/blob');
const { getPage, authenticatePage } = require('./vocabulary-pages');
const questions = require('../Penina-Quizzes/gemara-6-wl-2/questions.json');
const { grade, validCorrections } = require('./quiz-grading');
const GRADE_PREFIX = 'quiz-corrections/gemara-6-wl-2/';
const PREFIX = 'quiz-submissions/gemara-6-wl-2/';
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
function validate(body) {
    if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120
        || typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
        || !/^[a-f0-9]{32}$/.test(body.id || '') || !Array.isArray(body.answers) || body.answers.length !== questions.length) return false;
    return questions.every((q, i) => {
        const values = body.answers[i];
        return Array.isArray(values) && values.length === (q.fields?.length || 1)
            && values.every(v => typeof v === 'string' && v.length <= 2000)
            && (q.choices ? q.choices.includes(values[0]) : i >= 12 || values[0].trim());
    });
}
async function readRecords(prefix) {
    let cursor; const records = [];
    do {
        const result = await list({ prefix, cursor, limit: 1000 });
        for (let i = 0; i < result.blobs.length; i += 20) {
            records.push(...await Promise.all(result.blobs.slice(i, i + 20).map(async blob => {
                const response = await fetch(blob.url, { cache: 'no-store' });
                if (!response.ok) throw new Error('A quiz record could not be read.');
                return decrypt(await response.text());
            })));
        }
        cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return records;
}
module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    const body = req.body;
    try {
        if (body?.action === 'report' || body?.action === 'correct') {
            const denied = authenticatePage(await getPage('sixth'), body.password);
            if (denied) return res.status(denied.status).json({ error: denied.error });
            key();
            if (body.action === 'correct') {
                if (!/^[a-f0-9]{32}$/.test(body.id || '') || !validCorrections(body.scores)
                    || typeof body.feedback !== 'string' || body.feedback.length > 2000) {
                    return res.status(400).json({error:'Enter valid scores: 0–1 for questions 3 and 6, and 0–2 for questions 13 and 14. Half points are allowed.'});
                }
                const records = await readRecords(PREFIX + body.id + '.json');
                const record = records.find(r=>r.id===body.id);
                if (!record) return res.status(404).json({error:'This submission was not found.'});
                const correction = {id:body.id,scores:body.scores,feedback:body.feedback,savedAt:new Date().toISOString()};
                await put(GRADE_PREFIX + body.id + '/' + crypto.randomUUID() + '.json', encrypt(correction), {
                    access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false
                });
                return res.status(200).json({grading:grade(record.answers,correction)});
            }
            const [records,corrections] = await Promise.all([readRecords(PREFIX),readRecords(GRADE_PREFIX)]);
            const latest = new Map();
            for (const correction of corrections) {
                if (!latest.has(correction.id) || latest.get(correction.id).savedAt < correction.savedAt) latest.set(correction.id,correction);
            }
            return res.status(200).json({submissions:records.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))
                .map(record=>({...record,grading:grade(record.answers,latest.get(record.id))}))});
        }
        if (body?.action !== 'submit' || !validate(body)) return res.status(400).json({ error: 'Enter your name, school email, and an answer to each required question.' });
        key();
        const pathname = PREFIX + body.id + '.json';
        const record = { id: body.id, name: body.name.trim(), email: body.email.trim(), answers: body.answers, submittedAt: new Date().toISOString() };
        try {
            await put(pathname, encrypt(record), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false });
        } catch (error) {
            // A retry after a lost response must not overwrite or duplicate an accepted submission.
            const existing = await list({ prefix: pathname, limit: 1 });
            if (!existing.blobs.some(blob => blob.pathname === pathname)) throw error;
        }
        return res.status(200).json({ accepted: true, receipt: body.id });
    } catch (error) {
        console.error('Quiz request failed:', error.message);
        return res.status(503).json({ error: 'The quiz could not be saved or loaded. Your answers are still available on this page. Please try again.' });
    }
};
module.exports.encrypt = encrypt;
module.exports.decrypt = decrypt;
module.exports.validate = validate;
