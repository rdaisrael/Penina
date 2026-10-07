const { listPages, createPage } = require('../lib/vocabulary-pages');

module.exports = async function (req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (req.method === 'GET') return res.status(200).json({ pages: await listPages() });
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
        const supplied = req.body && req.body.creationPassword;
        if (typeof supplied !== 'string' || supplied.length > 256 || !/^[0-9]+-aw$/.test(supplied) || /\s/.test(supplied)) {
            return res.status(401).json({ error: 'The webpage creation password is incorrect.' });
        }
        const result = await createPage(req.body && req.body.name, req.body && req.body.password);
        return res.status(result.status).json(result.error ? { error: result.error } : { page: result.page });
    } catch (_error) {
        return res.status(500).json({ error: 'The webpage could not be saved or loaded. Please try again.' });
    }
};
