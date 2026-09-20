const crypto = require('crypto');
const { listPages, createPage } = require('../lib/vocabulary-pages');

const CREATION_PASSWORD_SALT = '4faa30f60e1960ddedf0893d8ebc0dd8';
const CREATION_PASSWORD_HASH = process.env.VOCABULARY_PAGE_CREATE_PASSWORD
    ? crypto.scryptSync(process.env.VOCABULARY_PAGE_CREATE_PASSWORD, CREATION_PASSWORD_SALT, 32)
    : Buffer.from('415b6eb7993b610c1c7504517b5da13a02b2b36d49c5777d6321081347b66eeb', 'hex');

module.exports = async function (req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (req.method === 'GET') return res.status(200).json({ pages: await listPages() });
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
        const supplied = req.body && req.body.creationPassword;
        if (typeof supplied !== 'string' || !supplied || supplied.length > 256) {
            return res.status(401).json({ error: 'The webpage creation password is incorrect.' });
        }
        const passwordHash = crypto.scryptSync(supplied, CREATION_PASSWORD_SALT, 32);
        if (!crypto.timingSafeEqual(passwordHash, CREATION_PASSWORD_HASH)) {
            return res.status(401).json({ error: 'The webpage creation password is incorrect.' });
        }
        const result = await createPage(req.body && req.body.name, req.body && req.body.password);
        return res.status(result.status).json(result.error ? { error: result.error } : { page: result.page });
    } catch (_error) {
        return res.status(500).json({ error: 'The webpage could not be saved or loaded. Please try again.' });
    }
};
