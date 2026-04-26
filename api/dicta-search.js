module.exports = async function (req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { query } = req.body || {};

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'A valid search query string is required' });
    }

    // Temporary safe stub:
    // Dicta's public search sites are live, but the previously used JSON endpoint is
    // currently returning a 404 HTML page upstream. Return an empty result set so the
    // frontend can fall back cleanly to Sefaria instead of surfacing a 502.
    return res.status(200).json({
        results: [],
        disabled: true
    });
};