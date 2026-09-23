const { list, put } = require('@vercel/blob');
const { getPage } = require('../lib/vocabulary-pages');

// Immutable submissions avoid lost scores when classmates finish simultaneously.
// Ranking metadata is in the pathname, so reading the board needs no per-score fetches.
async function topScores(grade) {
    const prefix = `flappy-scores/${grade}/`;
    const scores = [];
    let cursor;
    do {
        const result = await list({ prefix, cursor, limit: 1000 });
        for (const blob of result.blobs) {
            const match = blob.pathname.slice(prefix.length).match(/^(-?\d{4})-([A-Z]{1,3})-([a-zA-Z0-9-]{10,80})\.json$/);
            if (match) scores.push({ initials: match[2], score: Number(match[1]), submittedAt: blob.uploadedAt, runId: match[3] });
        }
        cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    scores.sort((a, b) => b.score - a.score || String(a.submittedAt).localeCompare(String(b.submittedAt)) || a.runId.localeCompare(b.runId));
    const seen = new Set();
    return scores.filter(entry => { if (seen.has(entry.runId)) return false; seen.add(entry.runId); return true; }).slice(0, 3).map(({ initials, score }) => ({ initials, score }));
}

module.exports = async function (req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
    const grade = String(req.query?.grade || '').toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(grade)) return res.status(400).json({ error: 'Choose a class webpage.' });
    try {
        if (!await getPage(grade)) return res.status(404).json({ error: 'Class webpage not found.' });
        if (req.method === 'POST') {
            const { initials, score, runId } = req.body || {};
            // Five answers worth at most 300 each; three mistakes cost at most 300.
            if (typeof initials !== 'string' || !/^[A-Z]{1,3}$/.test(initials) || !Number.isInteger(score) || score < -300 || score > 1500 || score % 50 || typeof runId !== 'string' || !/^[a-zA-Z0-9-]{10,80}$/.test(runId)) {
                return res.status(400).json({ error: 'Enter 1–3 initials and a valid completed-game score.' });
            }
            const pathname = `flappy-scores/${grade}/${(score<0?'-':'')+String(Math.abs(score)).padStart(4, '0')}-${initials}-${runId}.json`;
            try {
                await put(pathname, JSON.stringify({ initials, score }), { access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
            } catch (error) {
                // A repeated submit of this same completed run is idempotent.
                const existing = await list({ prefix: pathname, limit: 1 });
                if (!existing.blobs.some(blob => blob.pathname === pathname)) throw error;
            }
        }
        return res.status(200).json({ scores: await topScores(grade) });
    } catch (error) {
        console.error('Flappy leaderboard:', error);
        return res.status(503).json({ error: 'The class board is temporarily unavailable. Please try again.' });
    }
};
