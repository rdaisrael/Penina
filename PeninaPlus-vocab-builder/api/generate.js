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

        // STEP 1: Use Supplied Text or Ask Gemini
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
            
            if (!geminiResponse.ok || !geminiData.candidates) {
                return res.status(500).json({ error: 'Failed to generate story text from Gemini.' });
            }

            plainHebrew = geminiData.candidates[0].content.parts[0].text;
        }

        // STEP 2: Send to Dicta for Nikkud
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

        const dictaResponse = await fetch('https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify(dictaPayload)
        });

        if (!dictaResponse.ok) {
            return res.status(500).json({ error: 'Dicta API rejected the request.' });
        }

        const dictaData = await dictaResponse.json();
        
        // STEP 3: Reconstruct the final text
        let vowelizedText = "";
        
        if (dictaData && dictaData.data && Array.isArray(dictaData.data)) {
            dictaData.data.forEach(token => {
                if (token.sep) {
                    vowelizedText += token.str || " ";
                } else if (token.nakdan && token.nakdan.options && token.nakdan.options.length > 0) {
                    let wordWithVowels = token.nakdan.options[0].w.replace(/\|/g, '');
                    vowelizedText += wordWithVowels;
                } else if (token.nakdan && Array.isArray(token.nakdan) && token.nakdan.length > 0) {
                    let wordWithVowels = token.nakdan[0].w.replace(/\|/g, '');
                    vowelizedText += wordWithVowels;
                } else {
                    vowelizedText += token.str || "";
                }
            });
        } else {
             return res.status(500).json({ error: 'Dicta API returned an unrecognized data format.' });
        }

        // STEP 4: Send the perfect text back to the browser
        res.status(200).json({ text: vowelizedText });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: 'Internal server error during generation.' });
    }
}