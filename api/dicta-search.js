export default async function handler(req, res) {
    // 1. Enforce correct method
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { query, tractate, genre } = req.body;

    // 2. Input Validation (Prevent crashing on empty queries)
    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Valid search query string is required' });
    }

    // 3. Dynamic Endpoint Routing
    const isBiblical = genre === 'biblical';
    const endpoint = isBiblical 
        ? "https://tanakh.dicta.org.il/api/search" 
        : "https://talmud.dicta.org.il/api/search";

    // 4. Schema Formatting (Tanakh APIs usually expect 'book', Talmud expects 'tractate')
    const payload = {
        query: query,
        limit: 1 // Only need the top hit for context
    };
    
    if (tractate) {
        if (isBiblical) {
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

        // 5. Better upstream error surfacing
        if (!dictaRes.ok) {
            const errorText = await dictaRes.text();
            throw new Error(`Dicta API Error ${dictaRes.status}: ${errorText}`);
        }
        
        const data = await dictaRes.json();
        res.status(200).json(data);
        
    } catch (error) {
        console.error("Dicta Proxy Error:", error.message);
        res.status(500).json({ error: 'Failed to reach Dicta NLP service', details: error.message });
    }
}