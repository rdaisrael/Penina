const {generateOpenAIText}=require('./openai-text');
const {generateWorksheet}=require('./binyan-worksheet');
const {validateRequest}=require('../PeninaPlus-Binyan-Builder/core');
module.exports=async function(req,res) {
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
    let input;
    try {input=validateRequest(req.body);}catch(error){return res.status(400).json({error:error.message});}
    try {return res.status(200).json(await generateWorksheet(input,generateOpenAIText));}
    catch(error){return res.status(502).json({error:error.message});}
};
