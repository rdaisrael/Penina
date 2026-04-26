module.exports = async function (req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { query, tractate, genre } = req.body;

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Valid search query string is required' });
    }

    // Dicta's unified search endpoint
    const endpoint = "https://search.dicta.org.il/api/search";

    const payload = {
        query: query,
        limit: 1 
    };
    
    // Attach the specific book/tractate parameter if selected
    if (tractate && tractate !== "ANY" && tractate !== "") {
        if (genre === 'biblical') {
            payload.book = tractate; 
        } else {
            payload.tractate = tractate;
        }
    }

    try {
        const dictaRes = await fetch(endpoint, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Accept": "application/json"
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
        // Returns 500 so the frontend knows to instantly trigger the Sefaria fallback
        return res.status(500).json({ error: 'Failed to reach Dicta NLP service', details: error.message });
    }
};