'use strict';
const fs=require('node:fs'),path=require('node:path');
const {normalizeDeck}=require('../PeninaPlus-knowledge-builder/cards');
const app=path.join(__dirname,'../PeninaPlus-knowledge-builder');
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function makeStudentApp(input,{homeUrl='/PeninaPlus-vocab-builder/flash-cards/'}={}) {
    const deck=normalizeDeck(input);
    if(!/^\/(?!\/)/.test(homeUrl))homeUrl='/PeninaPlus-vocab-builder/flash-cards/';
    const serialized=JSON.stringify({deck,homeUrl}).replace(/</g,'\\u003c');
    let html=fs.readFileSync(path.join(app,'index.html'),'utf8');
    html=html.replace('<title>Penina Knowledge Builder</title>',`<title>${esc(deck.title)}</title>`);
    html=html.replace(/<link rel="stylesheet" href="knowledge-builder.css(?:\?[^\"]*)?">/,()=>`<style>${fs.readFileSync(path.join(app,'knowledge-builder.css'),'utf8').replace(/@font-face\{[^}]*\}/g,'')}</style>`);
    const files={
        'cards.js':path.join(app,'cards.js'),
        'knowledge-builder.js':path.join(app,'knowledge-builder.js'),
        'knowledge-workflow.js':path.join(app,'knowledge-workflow.js'),
        '../PeninaPlus-vocab-builder/practice-exercises.js':path.join(app,'../PeninaPlus-vocab-builder/practice-exercises.js')
    };
    // Inline both data and runtime; downloaded student cards work without a server or teacher storage.
    html=html.replace('</head>',`<script id="peninaKnowledgeData" type="application/json">${serialized}</script></head>`);
    const scripts=[];
    html=html.replace(/<script src="([^"?]+)(?:\?[^\"]*)?" defer><\/script>/g,(match,src)=>{
        if(!files[src])throw Error('Unexpected script in the knowledge student template.');
        scripts.push(fs.readFileSync(files[src],'utf8').replace(/<\/script/gi,'<\\/script'));return '';
    });
    const logo=fs.readFileSync(path.join(app,'../PeninaPlus-vocab-builder/peninaplus-logo.png')).toString('base64');
    const favicon=fs.readFileSync(path.join(app,'../PeninaPlus-vocab-builder/Penina-favicon.png')).toString('base64');
    html=html.replace(/\.\.\/PeninaPlus-vocab-builder\/peninaplus-logo\.png/g,`data:image/png;base64,${logo}`)
        .replace(/\.\.\/PeninaPlus-vocab-builder\/Penina-favicon\.png/g,`data:image/png;base64,${favicon}`);
    return html.replace('</body>',()=>`${scripts.map(script=>`<script>${script}</script>`).join('\n')}</body>`);
}
module.exports={makeStudentApp};
