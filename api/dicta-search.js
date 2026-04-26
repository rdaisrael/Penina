module.exports = async function (req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { query, tractate, genre } = req.body;

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'A valid search query string is required' });
    }

    const endpoint = "https://library.dicta.org.il/api/search";
    const dictaKey = process.env.DICTA_API_KEY;

    const payload = {
        query: query,
        from: 0,
        size: 1,
        filter: []
    };

    // Always constrain by corpus when possible.
    if (genre === 'biblical') {
        payload.filter.push({
            field: 'genre',
            value: 'biblical'
        });
    } else if (genre === 'rabbinic') {
        payload.filter.push({
            field: 'genre',
            value: 'rabbinic'
        });
    }

    // Further constrain to the chosen book / tractate if provided.
    if (tractate && tractate !== "ANY" && tractate !== "") {
        payload.filter.push({
            field: (genre === 'biblical') ? 'book' : 'tractate',
            value: tractate
        });
    }

    if (payload.filter.length === 0) {
        delete payload.filter;
    }

    try {
        const dictaRes = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": `Bearer ${dictaKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!dictaRes.ok) {
            const errorText = await dictaRes.text();
            throw new Error(`Dicta API Error ${dictaRes.status}: ${errorText}`);
        }

        const data = await dictaRes.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("Dicta Proxy Error:", error.message);
        return res.status(502).json({
            error: "Dicta search service is currently unavailable.",
            details: error.message
        });
    }
};