const crypto = require('crypto');
const { list, put } = require('@vercel/blob');

const BUILT_IN_PAGES = ['sixth', 'seventh', 'eighth'].map((id, index) => ({
    id,
    name: `${['Sixth', 'Seventh', 'Eighth'][index]} Grade Gemara Vocabulary`,
    url: `/PeninaPlus-vocab-builder/flash-cards/${id}-grade/`
}));
const PREFIX = 'vocabulary-pages/';

function publicPage(page) {
    return { id: page.id, name: page.name, url: page.url };
}

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function passwordVerifier(id, password) {
    // The server-only key prevents offline password guessing from public Blob metadata.
    const secret = process.env.VOCABULARY_PAGE_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret) throw new Error('Vocabulary page storage is not configured.');
    return crypto.createHmac('sha256', secret).update(JSON.stringify([id, password])).digest('hex');
}

async function readPage(blob) {
    const response = await fetch(blob.url);
    if (!response.ok) throw new Error('Unable to read vocabulary page.');
    const record = await response.json();
    if (!/^[a-z0-9-]{1,80}$/.test(record.id) || blob.pathname !== `${PREFIX}${record.id}.json`
        || typeof record.name !== 'string' || typeof record.passwordVerifier !== 'string') {
        throw new Error('Invalid vocabulary page.');
    }
    return { ...record, url: `/PeninaPlus-vocab-builder/flash-cards/?page=${encodeURIComponent(record.id)}` };
}

async function listPages() {
    const blobs = [];
    let cursor;
    do {
        const result = await list({ prefix: PREFIX, cursor, limit: 1000 });
        blobs.push(...result.blobs.filter(blob => blob.pathname.endsWith('.json')));
        cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    const pages = await Promise.all(blobs.map(readPage));
    pages.sort((a, b) => a.name.localeCompare(b.name));
    return [...BUILT_IN_PAGES, ...pages.map(publicPage)];
}

async function getPage(id) {
    const builtIn = BUILT_IN_PAGES.find(page => page.id === id);
    if (builtIn) return builtIn;
    if (!/^[a-z0-9-]{1,80}$/.test(id)) return null;
    const pathname = `${PREFIX}${id}.json`;
    const result = await list({ prefix: pathname, limit: 1 });
    const blob = result.blobs.find(item => item.pathname === pathname);
    return blob ? readPage(blob) : null;
}

function authenticatePage(page, password) {
    if (BUILT_IN_PAGES.some(item => item.id === page.id)) {
        const configuredKey = process.env[`CARD_PUBLISH_KEY_${page.id.toUpperCase()}`];
        if (!configuredKey) return { status: 503, error: `Publishing has not been configured for ${page.name} yet.` };
        if (safeEqual(password, configuredKey)) return null;
    } else if (typeof password === 'string' && safeEqual(passwordVerifier(page.id, password), page.passwordVerifier)) {
        return null;
    }
    return { status: 401, error: 'The publishing password is incorrect.' };
}

async function createPage(name, password) {
    name = typeof name === 'string' ? name.normalize('NFKC').replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > 120) return { status: 400, error: 'Enter a page name of 1–120 characters.' };
    if (typeof password !== 'string' || !password.trim() || password.length > 256) {
        return { status: 400, error: 'Enter a publishing password of 1–256 characters.' };
    }
    const normalized = name.toLowerCase();
    const slug = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
    const id = slug || `page-${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`;
    if (BUILT_IN_PAGES.some(page => page.id === id || page.name.toLowerCase() === normalized)) {
        return { status: 409, error: 'A page with that name already exists. Choose another name.' };
    }
    const record = { id, name, passwordVerifier: passwordVerifier(id, password) };
    try {
        await put(`${PREFIX}${id}.json`, JSON.stringify(record), {
            access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false
        });
    } catch (error) {
        // A fixed pathname and overwrite protection also protect against simultaneous creates.
        if (await getPage(id)) return { status: 409, error: 'A page with that name already exists. Choose another name.' };
        throw error;
    }
    return { status: 201, page: publicPage({ ...record, url: `/PeninaPlus-vocab-builder/flash-cards/?page=${id}` }) };
}

module.exports = { listPages, getPage, publicPage, authenticatePage, createPage };
