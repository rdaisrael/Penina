const {generateOpenAIText}=require('./openai-text');
const {generateWorksheet}=require('./binyan-worksheet');
const {validateRequest}=require('../PeninaPlus-Binyan-Builder/core');
module.exports=async function(req,res) {
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
    let input;
    try {input=validateRequest(req.body);}catch(error){return res.status(400).json({error:error.message});}
    const started=Date.now();
    try {return res.status(200).json(await generateWorksheet(input,generateOpenAIText,undefined,{
        onGeneration:attempt=>console.info('Binyan worksheet generation',attempt)
    }));}
    catch(error){
        // Vercel attaches the request ID. Record the failure category without
        // logging vocabulary, generated text, provider responses or credentials.
        const stage=error.worksheetStage || 'internal';
        const code=/^(DICTA|OPENAI)_[A-Z_]+$/.test(error.code || '')?error.code:'WORKSHEET_FAILED';
        console.error('Binyan worksheet failed',{stage,code,durationMs:Date.now()-started});
        // A rejected worksheet is an application error, not a bad gateway.
        // Returning 502 let the proxy replace the useful JSON with an HTML page.
        return res.status([422,503].includes(error.status)?error.status:500).json({error:error.message});
    }
};
