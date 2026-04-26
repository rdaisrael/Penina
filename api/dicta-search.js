export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { query, tractate } = req.body;

    try {
        const dictaRes = await fetch("https://talmud.dicta.org.il/api/search", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                query: query,
                tractate: tractate,
                limit: 1 // Only need the top hit for context
            })
        });

        if (!dictaRes.ok) throw new Error(`Dicta API responded with status: ${dictaRes.status}`);
        
        const data = await dictaRes.json();
        res.status(200).json(data);
    } catch (error) {
        console.error("Dicta Proxy Error:", error);
        res.status(500).json({ error: 'Failed to reach Dicta NLP service' });
    }
}