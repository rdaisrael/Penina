const crypto = require('crypto');
const { del, list, put } = require('@vercel/blob');

const GRADES = new Set(['sixth', 'seventh', 'eighth']);
const MAX_HTML_LENGTH = 4_000_000;

function send(res, status, payload) {
    res.status(status).json(payload);
}

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encodeTitle(title) {
    return Buffer.from(title, 'utf8').toString('base64url');
}

function decodeTitle(pathname) {
    const filename = String(pathname || '').split('/').pop() || '';
    const encoded = filename.replace(/\.html$/i, '').split('--').slice(1).join('--');
    try {
        return Buffer.from(encoded, 'base64url').toString('utf8') || 'Vocabulary Cards';
    } catch (_error) {
        return 'Vocabulary Cards';
    }
}

function formatSet(blob, grade) {
    return {
        title: decodeTitle(blob.pathname),
        url: `/api/notecard-sets?grade=${grade}&view=${encodeURIComponent(blob.pathname)}`,
        downloadUrl: blob.downloadUrl || blob.url,
        publishedAt: blob.uploadedAt,
        pathname: blob.pathname
    };
}

async function listAll(prefix) {
    const blobs = [];
    let cursor;
    do {
        const result = await list({ prefix, cursor, limit: 1000 });
        blobs.push(...result.blobs.filter(blob => /\.html$/i.test(blob.pathname)));
        cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return blobs;
}

module.exports = async function (req, res) {
    const grade = String((req.query && req.query.grade) || (req.body && req.body.grade) || '').toLowerCase();
    if (!GRADES.has(grade)) return send(res, 400, { error: 'Choose sixth, seventh, or eighth grade.' });

    try {
        if (req.method === 'GET') {
            const blobs = await listAll(`vocabulary-cards/${grade}/`);
            const requestedView = String((req.query && req.query.view) || '');
            if (requestedView) {
                const blob = blobs.find(item => item.pathname === requestedView);
                if (!blob) return send(res, 404, { error: 'That notecard set could not be found.' });
                const blobResponse = await fetch(blob.url);
                if (!blobResponse.ok) throw new Error(`Blob returned ${blobResponse.status}`);
                const html = await blobResponse.text();
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Content-Disposition', `inline; filename="${encodeTitle(decodeTitle(blob.pathname))}.html"`);
                res.setHeader('Cache-Control', 'no-store');
                return res.status(200).send(html);
            }
            const sets = blobs.map(blob => formatSet(blob, grade)).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
            res.setHeader('Cache-Control', 'no-store');
            return send(res, 200, { grade, sets });
        }

        if (!['POST', 'DELETE'].includes(req.method)) return send(res, 405, { error: 'Method Not Allowed' });

        const configuredKey = process.env[`CARD_PUBLISH_KEY_${grade.toUpperCase()}`];
        if (!configuredKey) return send(res, 503, { error: `Publishing has not been configured for ${grade} grade yet.` });
        if (!safeEqual(req.headers['x-penina-publish-key'], configuredKey)) {
            return send(res, 401, { error: 'The publishing password is incorrect.' });
        }

        if (req.method === 'DELETE') {
            const prefix = `vocabulary-cards/${grade}/`;
            const requestedPathnames = Array.isArray(req.body && req.body.pathnames) ? req.body.pathnames : [];
            const pathnames = [...new Set(requestedPathnames.map(value => String(value || '')))]
                .filter(pathname => pathname.startsWith(prefix) && /\.html$/i.test(pathname));
            if (!pathnames.length || pathnames.length !== requestedPathnames.length) {
                return send(res, 400, { error: 'Select one or more valid notecard sets to remove.' });
            }
            if (pathnames.length > 100) return send(res, 400, { error: 'No more than 100 sets can be removed at once.' });

            const existing = await listAll(prefix);
            const urlsByPathname = new Map(existing.map(blob => [blob.pathname, blob.url]));
            const urls = pathnames.map(pathname => urlsByPathname.get(pathname));
            if (urls.some(url => !url)) return send(res, 404, { error: 'One or more selected sets no longer exist.' });
            await del(urls);
            return send(res, 200, { grade, removed: pathnames });
        }

        if (req.body && req.body.action === 'authenticate') {
            return send(res, 200, { authenticated: true });
        }

        const title = String(req.body && req.body.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const html = String(req.body && req.body.html || '');
        if (!title) return send(res, 400, { error: 'Enter a title for this vocabulary set before publishing.' });
        if (!html || html.length > MAX_HTML_LENGTH) return send(res, 413, { error: 'The notecard set is empty or too large to publish.' });
        if (!html.includes('Offline bilingual vocabulary practice with adaptive flip cards.')) {
            return send(res, 400, { error: 'Only notecard sets created by Penina can be published here.' });
        }

        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
        const pathname = `vocabulary-cards/${grade}/${timestamp}--${encodeTitle(title)}.html`;
        const blob = await put(pathname, html, {
            access: 'public',
            contentType: 'text/html; charset=utf-8',
            addRandomSuffix: false
        });

        return send(res, 201, { grade, set: formatSet(blob, grade) });
    } catch (error) {
        console.error('Notecard publishing failed:', error);
        return send(res, 500, { error: 'The notecard library could not be reached. Please try again.' });
    }
};
