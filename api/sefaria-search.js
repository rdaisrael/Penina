module.exports = async function (req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        // The server makes the request to Sefaria (CORS does not exist here!)
        const sefariaRes = await fetch('https://www.sefaria.org/api/search-wrapper', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            // Pass the data exactly as we received it from your frontend
            body: JSON.stringify(req.body) 
        });

        if (!sefariaRes.ok) {
            return res.status(sefariaRes.status).json({ error: 'Sefaria API error' });
        }

        // Send Sefaria's data back to your frontend
        const data = await sefariaRes.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("Vercel API Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};