'use strict';
const crypto = require('crypto');
const {head, put, del, BlobNotFoundError, BlobPreconditionFailedError} = require('@vercel/blob');
const account = require('./quiz-account');
const {getPage, listPages} = require('./vocabulary-pages');

const ORIGIN = 'https://www.penina-hebrew.org';
const SESSION_SECONDS = 4 * 60 * 60;
const cookieName = id => '__Host-penina-page-' + id;
const markerPath = id => 'vocabulary-page-access/' + id + '.txt';
function fail(status, message) { throw Object.assign(Error(message), {status}); }

// The marker contains only random bytes. Its current storage version, a server secret,
// and the page's identity determine the code. Never read a cached public blob body.
async function currentVersion(id) {
    try {
        const marker = await head(markerPath(id));
        if (!marker.etag) fail(503, 'The page access code could not be checked.');
        return marker.etag;
    } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
    }
}
function accessCode(page, version) {
    const secret = process.env.VOCABULARY_PAGE_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret) fail(503, 'Page access codes are not configured.');
    const identity = page.passwordVerifier || process.env['CARD_PUBLISH_KEY_' + page.id.toUpperCase()] || '';
    return crypto.createHmac('sha256', secret).update(JSON.stringify(['page-access-v1', page.id, identity, version]))
        .digest('hex').slice(0, 20).toUpperCase().match(/.{4}/g).join('-');
}
function cookie(res, id, value, seconds) {
    res.setHeader('Set-Cookie', cookieName(id) + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + seconds);
}
async function sessionVersion(req, page) {
    const prefix = cookieName(page.id) + '=';
    const field = (req.headers?.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    if (!field) return null;
    let claims;
    try { claims = account.unseal(field.slice(prefix.length)); } catch (_) { return null; }
    if (claims?.kind !== 'class-page' || claims.id !== page.id || !(claims.exp > Date.now())) return null;
    const version = await currentVersion(page.id);
    return version && claims.code === accessCode(page, version) ? version : null;
}
async function handle(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') fail(405, 'Send page access requests using POST.');
    if (req.headers?.origin !== ORIGIN) fail(403, 'Open the page on Penina to continue.');
    const {operation, pageId} = req.body || {};
    if (!['sign-in', 'sign-out'].includes(operation) && !account.isAccountOwner(req))
        fail(403, 'Only the Penina administrator can manage page access codes.');
    if (operation === 'list') return res.status(200).json({pages: await listPages()});
    if (typeof pageId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(pageId)) fail(400, 'Choose a class page.');
    if (operation === 'sign-out') {
        cookie(res, pageId, '', 0);
        return res.status(200).json({ok:true});
    }
    const page = await getPage(pageId);
    if (!page) fail(404, 'This class page could not be found.');
    let version = await currentVersion(page.id);
    if (operation === 'sign-in') {
        const input = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase().replace(/[-\s]/g, '') : '';
        if (!/^[0-9A-F]{20}$/.test(input) || !version || !crypto.timingSafeEqual(Buffer.from(input), Buffer.from(accessCode(page, version).replace(/-/g, ''))))
            fail(401, 'That access code is incorrect or has been revoked.');
        const token = account.seal({kind:'class-page', id:page.id, code:accessCode(page, version), exp:Date.now() + SESSION_SECONDS * 1000});
        cookie(res, page.id, token, SESSION_SECONDS);
        return res.status(200).json({ok:true});
    }
    if (!['show', 'create', 'replace', 'revoke'].includes(operation)) fail(400, 'Choose a valid page access action.');
    if (operation !== 'show') {
        const conflict = () => fail(409, 'The code changed. Select this page again to see its current code.');
        if (req.body.version !== version || (operation === 'create') !== (version === null)) conflict();
        try {
            if (operation === 'revoke') {
                await del(markerPath(page.id), {ifMatch:version});
                version = null;
            } else {
                const saved = await put(markerPath(page.id), crypto.randomBytes(32).toString('hex'), {
                    access:'public', addRandomSuffix:false, allowOverwrite:!!version, ...(version ? {ifMatch:version} : {})
                });
                if (!saved.etag) fail(503, 'Select the page again to check the saved code.');
                version = saved.etag;
            }
        } catch (error) {
            if (error instanceof BlobPreconditionFailedError || await currentVersion(page.id) !== req.body.version) conflict();
            throw error;
        }
    }
    return res.status(200).json({version, code:version ? accessCode(page, version) : null});
}
module.exports = {handle, sessionVersion};
