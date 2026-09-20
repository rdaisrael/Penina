const { del, list, put } = require('@vercel/blob');
const { getPage, publicPage, authenticatePage } = require('../lib/vocabulary-pages');
const { makeApp, makeClassGames, practiceRows } = require('../PeninaPlus-vocab-builder/offline-study-cards');

const { makeSheet } = require('../PeninaPlus-vocab-builder/vocabulary-sheets');

const MAX_HTML_LENGTH = 4_000_000;

function send(res, status, payload) {
    res.status(status).json(payload);
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
        url: `/api/flashcard-sets?grade=${grade}&view=${encodeURIComponent(blob.pathname)}`,
        downloadUrl: `/api/flashcard-sets?grade=${grade}&view=${encodeURIComponent(blob.pathname)}&download=1`,
        printUrl: `/api/flashcard-sets?grade=${grade}&view=${encodeURIComponent(blob.pathname)}#print`,
        sheetUrl: `/api/flashcard-sets?grade=${grade}&view=${encodeURIComponent(blob.pathname)}&sheet=1`,
        sheetDownloadUrl: `/api/flashcard-sets?grade=${grade}&view=${encodeURIComponent(blob.pathname)}&sheet=1&action=download`,
        sheetPrintUrl: `/api/flashcard-sets?grade=${grade}&view=${encodeURIComponent(blob.pathname)}&sheet=1&action=print`,
        publishedAt: blob.uploadedAt,
        pathname: blob.pathname
    };
}

function savedCards(html) {
    const match = html.match(/<script id="peninaCardData" type="application\/json">([\s\S]*?)<\/script>/)
        || html.match(/const originalCards=(\[[\s\S]*?\]);let cards=/);
    if (!match) return [];
    const cards = JSON.parse(match[1]);
    return Array.isArray(cards) ? cards : [];
}

async function gameAvailability(blob) {
    try {
        const response = await fetch(blob.url);
        if (!response.ok) return false;
        const cards = savedCards(await response.text());
        return ['english', 'hebrew'].some(language => practiceRows(cards, language).length > 0);
    } catch (_error) {
        // A damaged or unavailable set must not prevent the rest of the library loading.
        return false;
    }
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
    try {
        const page = await getPage(grade);
        if (!page) return send(res, 400, { error: 'Choose an existing vocabulary webpage.' });
        if (req.method === 'GET') {
            const blobs = await listAll(`vocabulary-cards/${grade}/`);
            if (req.query.games === '1') {
                const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
                const groups = await Promise.all(blobs.map(async blob => {
                    const response = await fetch(blob.url);
                    if (!response.ok) throw new Error('A class set could not be loaded.');
                    const parts = Object.fromEntries(dateFormat.formatToParts(new Date(blob.uploadedAt)).map(part => [part.type, part.value]));
                    const studyDate = `${parts.year}-${parts.month}-${parts.day}`;
                    return savedCards(await response.text()).map(card => ({ ...card, studySet: blob.pathname, studyDate }));
                }));
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                return res.status(200).send(makeClassGames(page.name, groups.flat(), { homeUrl: page.url, leaderboardUrl: `/api/game-scores?game=asteroids&grade=${encodeURIComponent(grade)}` }));
            }
            const requestedView = String((req.query && req.query.view) || '');
            if (requestedView) {
                const blob = blobs.find(item => item.pathname === requestedView);
                if (!blob) return send(res, 404, { error: 'That flashcard set could not be found.' });
                const blobResponse = await fetch(blob.url);
                if (!blobResponse.ok) throw new Error(`Blob returned ${blobResponse.status}`);
                const storedHtml = await blobResponse.text();
                // Rebuild the display from saved card data so existing sets receive layout updates.
                const dataMatch = storedHtml.match(/<script id="peninaCardData" type="application\/json">([\s\S]*?)<\/script>/)
                    || storedHtml.match(/const originalCards=(\[[\s\S]*?\]);let cards=/);
                if (!dataMatch) throw new Error('Saved flashcard data is unavailable.');
                const cards = JSON.parse(dataMatch[1]);
                if (!Array.isArray(cards)) throw new Error('Saved flashcard data is invalid.');
                const optionsMatch = storedHtml.match(/<script id="peninaSheetOptions" type="application\/json">([\s\S]*?)<\/script>/);
                const sheetOptions = optionsMatch ? JSON.parse(optionsMatch[1]) : {};
                const host = String(req.headers?.host || '');
                const origin = /^[a-z0-9.-]+(?::[0-9]+)?$/i.test(host) ? `${host.startsWith('localhost:') || host.startsWith('127.0.0.1:') ? 'http' : 'https'}://${host}` : '';
                const html = req.query.sheet === '1'
                    ? makeSheet(decodeTitle(blob.pathname), cards, sheetOptions)
                    : makeApp(decodeTitle(blob.pathname), cards, { hideGames: true, matchingUrl: `/api/game-scores?game=matching&grade=${encodeURIComponent(grade)}&set=${encodeURIComponent(blob.pathname)}`, homeUrl: origin + (page.url || '/PeninaPlus-vocab-builder/flash-cards/'), leaderboardUrl: `/api/game-scores?game=asteroids&grade=${encodeURIComponent(grade)}` });
                const disposition = req.query.download === '1' ? 'attachment' : 'inline';
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Content-Disposition', `${disposition}; filename="${encodeTitle(decodeTitle(blob.pathname))}.html"`);
                res.setHeader('Cache-Control', 'no-store');
                return res.status(200).send(html);
            }
            const sets = [];
            // Bound storage reads when a class has many published sets.
            for (let offset = 0; offset < blobs.length; offset += 8) {
                sets.push(...await Promise.all(blobs.slice(offset, offset + 8).map(async blob => ({
                    ...formatSet(blob, grade), hasGames: await gameAvailability(blob)
                }))));
            }
            sets.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
            res.setHeader('Cache-Control', 'no-store');
            return send(res, 200, { grade, page: publicPage(page), sets });
        }

        if (!['POST', 'DELETE'].includes(req.method)) return send(res, 405, { error: 'Method Not Allowed' });

        const authenticationError = authenticatePage(page, req.body && req.body.password !== undefined
            ? req.body.password : req.headers['x-penina-publish-key']);
        if (authenticationError) return send(res, authenticationError.status, { error: authenticationError.error });

        if (req.method === 'DELETE') {
            const prefix = `vocabulary-cards/${grade}/`;
            const requestedPathnames = Array.isArray(req.body && req.body.pathnames) ? req.body.pathnames : [];
            const pathnames = [...new Set(requestedPathnames.map(value => String(value || '')))]
                .filter(pathname => pathname.startsWith(prefix) && /\.html$/i.test(pathname));
            if (!pathnames.length || pathnames.length !== requestedPathnames.length) {
                return send(res, 400, { error: 'Select one or more valid flashcard sets to remove.' });
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
        if (!html || html.length > MAX_HTML_LENGTH) return send(res, 413, { error: 'The flashcard set is empty or too large to publish.' });
        if (!html.includes('<script id="peninaCardData" type="application/json">')) {
            return send(res, 400, { error: 'Only flashcard sets created by Penina can be published here.' });
        }

        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
        const pathname = `vocabulary-cards/${grade}/${timestamp}--${encodeTitle(title)}.html`;
        const blob = await put(pathname, html, {
            access: 'public',
            contentType: 'text/html; charset=utf-8',
            addRandomSuffix: false
        });

        return send(res, 201, { grade, page: publicPage(page), set: { ...formatSet(blob, grade), hasGames: ['english', 'hebrew'].some(language => practiceRows(savedCards(html), language).length > 0) } });
    } catch (error) {
        console.error('Flashcard publishing failed:', error);
        return send(res, 500, { error: 'The flashcard library could not be reached. Please try again.' });
    }
};
