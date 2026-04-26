module.exports = async function (req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { query, tractate, genre } = req.body;

    // Validate the incoming query
    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'A valid search query string is required' });
    }

    /**
     * UPDATED ENDPOINT: 
     * The old 'search.dicta.org.il' subdomain is inactive.
     * The unified library search has moved to the 'library' cluster.
     */
    const endpoint = "https://library.dicta.org.il/api/search";

    /**
     * API KEY USAGE:
     * Using your key via the Authorization header ensures your requests 
     * are identified as part of the Penina project and helps bypass 
     * generic cloud-hosting rate limits.
     */
    const dictaKey = process.env.DICTA_API_KEY;

    // New Schema: Dicta now uses 'size' instead of 'limit'
    const payload = {
        query: query,
        from: 0,
        size: 1 
    };

    /**
     * UPDATED FILTERING:
     * The new API uses a formal 'filter' array rather than top-level params.
     */
    if (tractate && tractate !== "ANY" && tractate !== "") {
        payload.filter = [
            {
                field: (genre === 'biblical') ? 'book' : 'tractate',
                value: tractate
            }
        ];
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

        // Handle failure at the Dicta level
        if (!dictaRes.ok) {
            const errorText = await dictaRes.text();
            throw new Error(`Dicta API Error ${dictaRes.status}: ${errorText}`);
        }
        
        const data = await dictaRes.json();

        /**
         * Return the result as 200. Since you no longer want to use the Sefaria backup, 
         * we ensure this proxy returns a successful response structure that the 
         * frontend can parse immediately.
         */
        return res.status(200).json(data);
        
    } catch (error) {
        console.error("Dicta Proxy Error:", error.message);
        
        /**
         * We return a 502 (Bad Gateway) to distinguish between a bug in your code 
         * and a failure of the external Dicta service.
         */
        return res.status(502).json({ 
            error: "Dicta search service is currently unavailable.", 
            details: error.message 
        });
    }
};