const crypto = require('node:crypto');
const liveStore = require('./live-store');
const { list, put } = require('@vercel/blob');
const { getPage, authenticatePage } = require('./vocabulary-pages');
const { practiceRows } = require('../PeninaPlus-vocab-builder/offline-study-cards');
const TTL = 4 * 60 * 60 * 1000;
const immutableCache = new Map();
const emailSends = new Map();
const roomReads = new Map();
const ROOM_CACHE_MS = 750;
const prefix = code => `live-vocab/v1/${code}/`;
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function key() {
    const secret = process.env.VOCABULARY_PAGE_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret) fail(503, 'Live games are not configured yet.');
    return crypto.createHash('sha256').update('penina-live-v1:' + secret).digest();
}
function seal(value) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function unseal(value) {
    const cipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64'));
    cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString('utf8'));
}
function token(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', key()).update(body).digest('base64url');
}
function identity(req, code) {
    const raw = String(req.headers?.authorization || '').replace(/^Bearer /, '');
    const [body, signature, extra] = raw.split('.');
    if (!body || !signature || extra || raw.length > 2000) fail(401, 'Rejoin this game to continue.');
    const expected = crypto.createHmac('sha256', key()).update(body).digest('base64url');
    const a = Buffer.from(signature), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail(401, 'Rejoin this game to continue.');
    let claims; try { claims = JSON.parse(Buffer.from(body, 'base64url')); } catch (_) { fail(401, 'Invalid game access.'); }
    if (claims.code !== code || claims.expiresAt <= Date.now() || !['host', 'student'].includes(claims.role)) fail(401, 'Game access has expired.');
    return claims;
}
function liveTopic(code) { return 'penina-' + crypto.createHmac('sha256',key()).update('realtime:' + code).digest('hex'); }
async function all(path) {
    if (liveStore.configured() && path.startsWith('live-vocab/')) return liveStore.list(path);
    const blobs = []; let cursor;
    do { const page = await list({ prefix: path, limit: 1000, cursor }); blobs.push(...page.blobs); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
    return blobs;
}
async function read(blob) {
    if (blob.payload !== undefined) return unseal(JSON.parse(blob.payload));
    const cached = immutableCache.get(blob.url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const response = await fetch(blob.url);
    if (!response.ok) throw new Error('Storage read failed.');
    const value = unseal(await response.json());
    if (immutableCache.size >= 2000) immutableCache.delete(immutableCache.keys().next().value);
    immutableCache.set(blob.url, { value, expiresAt: Date.now() + TTL });
    return value;
}
async function write(path, value) {
    const code = path.match(/^live-vocab\/v1\/(\d{6})\//)?.[1];
    if (code) roomReads.delete(code);
    if (liveStore.configured()) {
        try { await liveStore.put(path, seal(value), liveTopic(code)); }
        finally { if (code) roomReads.delete(code); }
        return;
    }
    try { await put(path, seal(value), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false }); }
    catch (error) {
        const found = await list({ prefix: path, limit: 1 });
        if (found.blobs.some(blob => blob.pathname === path)) fail(409, 'This action was already saved. Refreshing the game will show it.');
        throw error;
    } finally { if (code) roomReads.delete(code); }
}
function shuffle(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
}
async function room(code, shareRead = false) {
    if (!shareRead || liveStore.configured()) return loadRoom(code);
    const cached = roomReads.get(code);
    if (cached && cached.until > Date.now()) return cached.promise;
    if (roomReads.size >= 100) roomReads.delete(roomReads.keys().next().value);
    const entry = { until: Date.now() + ROOM_CACHE_MS, promise: loadRoom(code) };
    roomReads.set(code, entry);
    try { return await entry.promise; }
    catch (error) { if (roomReads.get(code) === entry) roomReads.delete(code); throw error; }
}
async function loadRoom(code) {
    const blobs = await all(prefix(code));
    const configBlob = blobs.find(blob => blob.pathname === prefix(code) + 'config.enc');
    if (!configBlob) fail(404, 'That game code was not found. Check the six digits on the board.');
    const config = { ...await read(configBlob) };
    if (config.expiresAt <= Date.now()) fail(410, 'This game has expired. Ask your teacher to start a new one.');
    const states = blobs.filter(blob => /\/state\/\d{4}\.enc$/.test(blob.pathname)).sort((a, b) => b.pathname.localeCompare(a.pathname));
    const state = states.length ? await read(states[0]) : { version: 0, phase: 'lobby', index: -1 };
    if (state.settingsVersion) {
        const settingsState = state.settings || (await read(blobs.find(blob => blob.pathname === prefix(code) + 'state/' + String(state.settingsVersion).padStart(4, '0') + '.enc'))).settings;
        Object.assign(config, settingsState);
    }
    return { config, state, blobs };
}
function deadline(game) {
    if (!game.config.seconds || game.state.paused) return null;
    return game.state.phase === 'question' ? game.state.at + game.config.seconds * 1000 : game.state.phase === 'reveal' ? game.state.at + (game.config.revealSeconds ?? 2) * 1000 : null;
}
async function advanceTimed(game) {
    const due = deadline(game);
    if (!due || Date.now() < due) return game;
    const next = { version: game.state.version + 1, round: game.state.round || 0, settingsVersion: game.state.settingsVersion, index: game.state.index, at: Date.now() };
    if (game.state.phase === 'question') { next.phase = 'reveal'; next.answerCutoff = due; }
    else { next.index++; next.phase = next.index >= game.config.questions.length ? 'ended' : 'question'; }
    try { await write(prefix(game.config.code) + 'state/' + String(next.version).padStart(4, '0') + '.enc', next); }
    catch (error) { if (error.status !== 409) throw error; }
    return room(game.config.code);
}
async function players(game) {
    return Promise.all(game.blobs.filter(blob => /\/players\/[a-f0-9]{32}\.enc$/.test(blob.pathname)).map(read));
}
async function answers(game) {
    return Promise.all(game.blobs.filter(blob => blob.pathname.startsWith(roundPrefix(game) + 'answers/') && /\/answers\/\d{2}\/[a-f0-9]{32}\.enc$/.test(blob.pathname)).map(read));
}
function playerBlob(code, id) { return prefix(code) + 'players/' + id + '.enc'; }
function roundPrefix(game) { return prefix(game.config.code) + (game.state.round ? 'rounds/' + game.state.round + '/' : ''); }
function answerBlob(game, index, id) { return roundPrefix(game) + 'answers/' + String(index).padStart(2, '0') + '/' + id + '.enc'; }
async function snapshot(game, who, includeReveal = true, includeSchoolEmails = false) {
    const { config, state } = game;
    const roster = await players(game);
    if (who.role === 'student' && !roster.some(p => p.id === who.id)) fail(401, 'Rejoin this game.');
    const submissions = await answers(game);
    const reveals = (await Promise.all(game.blobs.filter(blob => /\/state\//.test(blob.pathname)).map(read))).filter(s => (s.round || 0) === (state.round || 0));
    const cutoffs = new Map(reveals.filter(s => s.phase === 'reveal').map(s => [s.index, s.answerCutoff ?? s.at]));
    const valid = submissions.filter(a => !cutoffs.has(a.index) || a.at <= cutoffs.get(a.index));
    const current = valid.filter(a => a.index === state.index);
    const scores = roster.map(p => ({ id: p.id, name: p.name, schoolEmail: p.schoolEmail || '', score: valid.filter(a => a.id === p.id && cutoffs.has(a.index) && a.choice === config.questions[a.index]?.correct).length * 100 }));
    scores.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const result = { code: config.code, className: config.className, classUrl: config.classUrl, phase: state.phase, round: state.round || 0, revealSeconds: config.revealSeconds ?? 2, version: state.version, index: state.index, total: config.questions.length, playerCount: roster.length, answeredCount: current.length, expiresAt: config.expiresAt, paused: !!state.paused, seconds: config.seconds || 0, deadline: deadline(game), serverNow: Date.now() };
    result.realtime = liveStore.realtime(liveTopic(config.code));
    if (who.role === 'host' && ['lobby', 'ended'].includes(state.phase) && config.wordlists) {
        result.settings = { count: config.count, seconds: config.seconds || 0, revealSeconds: config.revealSeconds ?? 2,
            pathnames: config.pathnames, wordlists: config.wordlists.map(({ pathname, title, rows }) => ({ pathname, title, terms: rows.length })) };
    }
    if (who.role === 'host') result.players = roster.map(p => ({ id: p.id, name: p.name, answered: current.some(a => a.id === p.id) }));
    if (state.index >= 0 && state.phase !== 'ended') {
        const q = config.questions[state.index];
        result.question = { term: q.term, options: q.options };
        if (state.phase === 'reveal') { result.question.correct = q.correct; result.distribution = q.options.map((_, i) => current.filter(a => a.choice === i).length); }
    }
    if (who.role === 'student') {
        const mine = current.find(a => a.id === who.id);
        result.me = { name: roster.find(p => p.id === who.id).name, score: scores.find(p => p.id === who.id).score, choice: mine?.choice ?? null };
    }
    // Never send answer keys or interim scores before the teacher reveals the answer.
    if (state.phase === 'reveal' || state.phase === 'ended') result.scores = scores.slice(0, 3).map(({ name, score }) => ({ name, score }));
    if (who.role === 'host' && state.phase === 'ended') result.finalScores = scores.map(({ name, score, schoolEmail }) => ({ name, score, ...(includeSchoolEmails ? { schoolEmail } : {}) }));
    if (includeReveal && state.phase !== 'reveal') {
        const last = reveals.filter(s => s.phase === 'reveal').sort((a,b) => b.version-a.version)[0];
        if (last) result.lastReveal = await snapshot({ ...game, state: last }, who, false);
    }
    return result;
}
async function sendFinalScores(game) {
    if (game.state.phase !== 'ended' || !game.config.teacherEmail) return null;
    const sentPath = roundPrefix(game) + 'score-email.enc';
    if (game.blobs.some(blob => blob.pathname === sentPath)) return { status: 'sent' };
    const sendKey = game.config.code + ':' + game.config.expiresAt + ':' + (game.state.round || 0);
    if (emailSends.has(sendKey)) return emailSends.get(sendKey);
    const sending = (async () => {
        try {
            if (!process.env.RESEND_API_KEY || !process.env.LIVE_SCORE_EMAIL_FROM) throw new Error('Email service unavailable');
            const report = await snapshot(game, { role: 'host' }, false, true);
            const roundStates = (await Promise.all(game.blobs.filter(blob => /\/state\//.test(blob.pathname)).map(read)))
                .filter(state => (state.round || 0) === (game.state.round || 0));
            const started = roundStates.filter(state => state.phase === 'question').sort((a, b) => a.version - b.version)[0];
            const timeZone = game.config.timeZone || 'America/New_York';
            const formatTime = timestamp => new Intl.DateTimeFormat('en-US', {
                timeZone, year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
            }).format(new Date(timestamp));
            const text = [game.config.className + ' — Live game scores',
                'Wordlist page: ' + game.config.className,
                'Game started: ' + (started ? formatTime(started.at) : 'Not started — ended in lobby'),
                'Game ended: ' + formatTime(game.state.at), 'Time zone: ' + timeZone,
                'Game code: ' + game.config.code,
                'Questions scored: ' + new Set(roundStates.filter(state => state.phase === 'reveal').map(state => state.index)).size,
                '100 points per correct answer. Unrevealed questions are not counted.', '',
                ...report.finalScores.map((student, index) => `${index + 1}. ${student.name}: ${student.score} points — School email: ${student.schoolEmail || 'Not provided (joined before email was required)'}`)
            ].join('\n');
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'penina-scores-' + sendKey },
                body: JSON.stringify({ from: process.env.LIVE_SCORE_EMAIL_FROM, to: [game.config.teacherEmail], subject: 'Penina live game scores — ' + game.config.className, text }),
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) throw new Error('Email service rejected request');
            try { await write(sentPath, { sentAt: Date.now() }); } catch (error) { if (error.status !== 409) throw error; }
            return { status: 'sent' };
        } catch (_) { return { status: 'failed' }; }
    })();
    emailSends.set(sendKey, sending);
    try { return await sending; } finally { emailSends.delete(sendKey); }
}

function buildQuestions(rows, count) {
    const unique = [...new Map(rows.map(row => [JSON.stringify([row.term, row.definition]), row])).values()];
    if (!unique.length) fail(400, 'These sets have no teacher-approved choices in that language. Choose another language or set.');
    return shuffle(unique).slice(0, count).map(row => {
        const options = shuffle([row.definition, ...shuffle(row.answers).slice(0, 3)]);
        return { term: row.term, options, correct: options.indexOf(row.definition) };
    });
}
function replaySettings(config, body) {
    if (!config.wordlists) fail(409, 'Start a new game from your class page to enable replay settings.');
    const count = body.count ?? config.count, seconds = body.seconds ?? config.seconds ?? 0;
    const revealSeconds = body.revealSeconds ?? config.revealSeconds ?? 2;
    if (![5, 10, 15, 20].includes(count)) fail(400, 'Choose 5, 10, 15, or 20 questions.');
    if (![0, 5, 7, 10].includes(seconds)) fail(400, 'Choose manual pacing or 5, 7, or 10 seconds per question.');
    if (![2, 5, 7, 10, 15, 20, 30].includes(revealSeconds)) fail(400, 'Choose a pause of 2, 5, 7, 10, 15, 20, or 30 seconds.');
    const pathnames = body.pathnames ?? config.pathnames;
    if (!Array.isArray(pathnames) || !pathnames.length || new Set(pathnames).size !== pathnames.length
        || pathnames.some(path => !config.wordlists.some(set => set.pathname === path))) fail(400, 'Include at least one wordlist from this game.');
    const rows = config.wordlists.filter(set => pathnames.includes(set.pathname)).flatMap(set => set.rows);
    return { count, seconds, revealSeconds, pathnames, questions: buildQuestions(rows, count) };
}

async function create(body) {
    const grade = String(body.grade || ''), page = await getPage(grade);
    if (!page) fail(400, 'Choose an existing class webpage.');
    const denied = authenticatePage(page, body.password); if (denied) fail(denied.status, denied.error);
    const teacherEmail = body.sendScoresToTeacher === true && typeof body.teacherEmail === 'string' ? body.teacherEmail.trim() : '';
    if (body.sendScoresToTeacher === true) {
        if (!teacherEmail || teacherEmail.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(teacherEmail)) fail(400, 'Enter a valid teacher email address to receive scores.');
        if (!process.env.RESEND_API_KEY || !process.env.LIVE_SCORE_EMAIL_FROM) fail(503, 'Automatic score emails are not set up yet. Uncheck “Send scores to teacher” to start without email.');
    }
    const timeZone = body.timeZone ?? 'America/New_York';
    try {
        if (typeof timeZone !== 'string' || timeZone.length > 100) throw new Error('Invalid time zone');
        new Intl.DateTimeFormat('en-US', { timeZone }).format();
    } catch (_) { fail(400, 'Choose a valid time zone for the game report.'); }
    const chosen = body.pathnames;
    if (!Array.isArray(chosen) || !chosen.length || chosen.length > 20 || new Set(chosen).size !== chosen.length || chosen.some(p => typeof p !== 'string' || !p.startsWith(`vocabulary-cards/${grade}/`) || !p.endsWith('.html'))) fail(400, 'Choose 1–20 vocabulary sets from this class.');
    if (!['english', 'hebrew'].includes(body.language) || ![5, 10, 15, 20].includes(body.count)) fail(400, 'Choose an answer language and 5, 10, 15, or 20 questions.');
    const seconds = body.seconds ?? 0;
    if (![0, 5, 7, 10].includes(seconds)) fail(400, 'Choose manual pacing or 5, 7, or 10 seconds.');
    const available = await all(`vocabulary-cards/${grade}/`);
    const rows = [], wordlists = [];
    for (const path of chosen) {
        const blob = available.find(b => b.pathname === path); if (!blob) fail(404, 'A selected set is no longer available.');
        const response = await fetch(blob.url); if (!response.ok) throw new Error('Set read failed.');
        const html = await response.text();
        const match = html.match(/<script id="peninaCardData" type="application\/json">([\s\S]*?)<\/script>/) || html.match(/const originalCards=(\[[\s\S]*?\]);let cards=/);
        if (!match) fail(400, 'A selected set needs to be republished before it can be used.');
        const setRows = practiceRows(JSON.parse(match[1]), body.language);
        const encodedTitle = path.slice(path.lastIndexOf('--') + 2, -5);
        const title = path.includes('--') ? Buffer.from(encodedTitle, 'base64url').toString('utf8') : path.split('/').pop().replace(/\.html$/, '');
        wordlists.push({ pathname: path, title, rows: setRows });
        rows.push(...setRows);
    }
    const questions = buildQuestions(rows, body.count);
    if (liveStore.configured()) await liveStore.prune();
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = String(crypto.randomInt(100000, 1000000)), expiresAt = Date.now() + TTL;
        try { await write(prefix(code) + 'config.enc', { code, grade, className: page.name, classUrl: page.url, questions, seconds, count: body.count, revealSeconds: 2, pathnames: chosen, wordlists, timeZone, expiresAt, ...(teacherEmail ? { teacherEmail } : {}) }); }
        catch (error) { if (error.status === 409) continue; throw error; }
        return { code, hostToken: token({ role: 'host', code, expiresAt }), total: questions.length, expiresAt };
    }
    fail(503, 'Could not open a lobby. Please try again.');
}
module.exports = async function liveGame(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); fail(405, 'Method not allowed.'); }
        const body = req.body || {};
        if (req.method === 'POST' && !String(req.headers?.['content-type'] || '').includes('application/json')) fail(415, 'Send game actions as JSON.');
        if (req.method === 'POST' && body.action === 'create') return res.status(201).json(await create(body));
        const code = String(req.query?.code || body.code || '');
        if (!/^\d{6}$/.test(code)) fail(400, 'Enter the six-digit game code.');
        // Reject invalid access before spending a storage operation. Joins use the public room code.
        const who = body.action === 'join' && req.method === 'POST' ? null : identity(req, code);
        let game = await room(code, req.method === 'GET');
        if (req.method === 'POST' && body.action === 'join') {
            if (game.state.phase !== 'lobby') fail(409, 'This game has already started. Ask your teacher to open another lobby.');
            const name = typeof body.name === 'string' ? body.name.normalize('NFKC').trim().toUpperCase() : '';
            if (!/^\p{L}{1,3}$/u.test(name) || !/^[a-f0-9-]{32,40}$/.test(body.joinKey || '')) fail(400, 'Enter 1–3 letters for your initials.');
            const schoolEmail = typeof body.schoolEmail === 'string' ? body.schoolEmail.trim() : '';
            if (!schoolEmail || schoolEmail.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(schoolEmail)) fail(400, 'Enter a valid school email address.');
            const id = crypto.createHash('sha256').update(code + ':' + body.joinKey).digest('hex').slice(0, 32);
            const roster = await players(game);
            if (!roster.some(p => p.id === id)) {
                if (roster.length >= 100) fail(409, 'This lobby is full.');
                try { await write(playerBlob(code, id), { id, name, schoolEmail }); } catch (error) { if (error.status !== 409) throw error; }
            }
            return res.status(200).json({ code, studentToken: token({ role: 'student', code, id, expiresAt: game.config.expiresAt }) });
        }
        game = await advanceTimed(game);
        if (req.method === 'GET') {
            const result = await snapshot(game, who);
            const scoreEmail = await sendFinalScores(game);
            if (who.role === 'host' && scoreEmail) result.scoreEmail = scoreEmail;
            return res.status(200).json(result);
        }
        if (body.action === 'answer') {
            if (who.role !== 'student') fail(403, 'Only a student can answer.');
            if ((body.round ?? 0) !== (game.state.round || 0) || game.state.paused || game.state.phase !== 'question' || body.index !== game.state.index || !Number.isInteger(body.choice) || body.choice < 0 || body.choice > 3) fail(409, 'This question is closed or has changed.');
            if (!game.blobs.some(b => b.pathname === playerBlob(code, who.id))) fail(401, 'Rejoin this game.');
            const submittedAt = Date.now();
            if (deadline(game) && submittedAt >= deadline(game)) fail(409, 'Time is up for this question.');
            const path = answerBlob(game, body.index, who.id);
            try { await write(path, { id: who.id, index: body.index, choice: body.choice, at: submittedAt }); }
            catch (error) { if (error.status !== 409) throw error; }
            // The first choice wins, including after reconnects or duplicate taps.
            return res.status(200).json({ saved: true });
        }
        if (who.role !== 'host') fail(403, 'Only the teacher can control the game.');
        if (body.version !== game.state.version) fail(409, 'The game changed. Refresh and try again.');
        const next = { version: game.state.version + 1, round: game.state.round || 0, settingsVersion: game.state.settingsVersion, index: game.state.index, at: Date.now() };
        if ((body.action === 'restart' && game.state.phase === 'ended') || (body.action === 'configure' && game.state.phase === 'lobby')) {
            next.phase = 'lobby'; next.index = -1;
            next.round = (game.state.round || 0) + (body.action === 'restart' ? 1 : 0);
            next.settings = replaySettings(game.config, body);
            next.settingsVersion = next.version;
        } else if (body.action === 'pause' && !game.state.paused && ['question','reveal'].includes(game.state.phase)) {
            Object.assign(next, game.state, { version: next.version, paused: true, pausedAt: Date.now() });
        } else if (body.action === 'resume' && game.state.paused) {
            Object.assign(next, game.state, { version: next.version, paused: false, at: game.state.at + Date.now() - game.state.pausedAt });
        } else if (game.state.paused && body.action !== 'end') fail(409, 'Resume the game first.');
        else if (body.action === 'start' && game.state.phase === 'lobby') {
            if (!(await players(game)).length) fail(409, 'Wait for at least one student to join.');
            next.phase = 'question'; next.index = 0;
        } else if (body.action === 'reveal' && game.state.phase === 'question') { next.phase = 'reveal'; next.answerCutoff = Date.now(); }
        else if (body.action === 'next' && game.state.phase === 'reveal') {
            next.index++; next.phase = next.index >= game.config.questions.length ? 'ended' : 'question';
        } else if (body.action === 'end' && game.state.phase !== 'ended') next.phase = 'ended';
        else fail(409, 'That action is not available right now.');
        await write(prefix(code) + 'state/' + String(next.version).padStart(4, '0') + '.enc', next);
        if (next.phase === 'ended') await sendFinalScores(await room(code));
        return res.status(200).json({ updated: true });
    } catch (error) {
        if (!error.status) console.error('Live game request failed:', error.message);
        return res.status(error.status || 503).json({ error: error.status ? error.message : 'The live game is temporarily unavailable. Please try again.' });
    }
};
