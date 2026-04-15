module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { prompt, suppliedText } = req.body;
        const GEMINI_KEY = process.env.GEMINI_API_KEY;
        const DICTA_KEY = process.env.DICTA_API_KEY;

        if (!GEMINI_KEY || !DICTA_KEY) {
            return res.status(500).json({ error: 'Server config error: Missing API keys.' });
        }

        let plainHebrew = "";

        // STEP 1: Content Generation
        if (suppliedText) {
            plainHebrew = suppliedText;
        } else {
            const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt + " \n\nCRITICAL INSTRUCTION: Return ONLY plain Hebrew text. Do NOT include any nikkud (vowels). Do NOT include any English or markdown formatting." }] }],
                    generationConfig: { temperature: 0.7 }
                })
            });

            const geminiData = await geminiResponse.json();
        
            if (!geminiResponse.ok || !geminiData.candidates || !geminiData.candidates[0].content) {
                const errorReason = geminiData.candidates?.[0]?.finishReason || "API returned no content or was blocked.";
                return res.status(500).json({ error: `Gemini Error: ${errorReason}` });
            }

            plainHebrew = geminiData.candidates[0].content.parts[0].text;
        }

        // STEP 2: Vocalization (Dicta API)
        const dictaPayload = {
            task: "nakdan",
            useTokenization: true,
            genre: "modern",
            data: plainHebrew,
            addmorph: false,
            matchpartial: false,
            keepmetagim: false,
            keepqq: true,
            apiKey: DICTA_KEY 
        };

        // FIXED: Corrected URL and specific text/plain header required by Dicta
        const dictaResponse = await fetch('https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify(dictaPayload)
        });

       if (!dictaResponse.ok) {
            const errorText = await dictaResponse.text();
            console.error(`Status: ${dictaResponse.status}, Error: ${errorText}`);
            return res.status(500).json({ 
                error: `Dicta rejected the request (Status ${dictaResponse.status}).` 
            });
        }

        const dictaData = await dictaResponse.json();
        
        // STEP 3: Reconstruction
        let vowelizedText = "";
        if (dictaData && dictaData.data && Array.isArray(dictaData.data)) {
            dictaData.data.forEach(token => {
                if (token.sep) {
                    vowelizedText += token.str || " ";
                } else if (token.nakdan && token.nakdan.options && token.nakdan.options.length > 0) {
                    let wordWithVowels = token.nakdan.options[0].w.replace(/\|/g, '');
                    vowelizedText += wordWithVowels;
                } else {
                    vowelizedText += token.str || "";
                }
            });
        } else {
             return res.status(500).json({ error: 'Dicta API returned an unrecognized format.' });
        }

        res.status(200).json({ text: vowelizedText });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: 'Internal server error during generation.' });
    }
}