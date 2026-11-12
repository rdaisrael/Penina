'use strict';
const fs=require('node:fs'),path=require('node:path');
const {normalizeDeck}=require('../PeninaPlus-knowledge-builder/cards');
const {studyStyles,fitText,classHomeButtonContent}=require('../PeninaPlus-vocab-builder/offline-study-cards');
const app=path.join(__dirname,'../PeninaPlus-knowledge-builder');
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function studentStudyMarkup() {
    return `<section id="study-stage" aria-label="Electronic flashcards" hidden>
    <div class="layout"><div class="sidebar"><header><h1 id="study-title" dir="auto"></h1><div class="badge"><span id="study-count"></span></div></header><aside class="panel">
      <div class="actions"><button id="shuffle" type="button">Shuffle</button><button id="reset-study" type="button">Reset</button></div>
      <div class="stats"><div class="stat"><b id="known-count">0</b><span>Know</span></div><div class="stat"><b id="almost-count">0</b><span>Almost</span></div><div class="stat"><b id="learning-count">0</b><span>Learning</span></div></div>
      <p class="note">Keyboard: space flips to the next side; arrow keys move between cards.</p>
      <p class="section-title" style="margin-top:16px">Paper Flashcards</p><button type="button" data-stage="print" style="width:100%">Print Paper Flashcards</button>
      <button id="student-practice" class="student-practice" type="button" data-stage="quiz" hidden>Practice</button><button id="edit-current" type="button" hidden>Edit This Card</button>
    </aside></div><section class="stage">
      <div class="topbar"><span id="position"></span><div class="progress" role="progressbar" aria-label="Card position" aria-valuemin="0" aria-valuemax="100"><div id="progress-bar" class="bar"></div></div></div>
      <div class="card-area"><article id="flashcard" class="card" tabindex="0" aria-label="Flashcard. Press Space or Enter to flip.">
        <div id="card-number" class="corner"></div><div id="side-number" class="side" aria-hidden="true">1 / 2</div><div id="study-side-label" class="label">Question</div>
        <div id="card-content" class="card-content" aria-live="polite"></div>
      </article></div>
      <div class="context-slot"><section id="additional-panel" class="context" aria-labelledby="additional-heading" hidden><div id="additional-heading" class="label">Additional Information</div><div class="context-body"><p id="additional-text" class="context-text" dir="auto"></p></div></section></div>
      <div class="controls"><button id="previous" type="button">← Previous</button><button id="flip" class="primary" type="button">Flip</button><button id="next" type="button">Next →</button></div>
      <div class="ratings"><button type="button" class="know" data-rating="known">I know it</button><button type="button" class="almost" data-rating="almost">Almost</button><button type="button" class="learning" data-rating="learning">Still learning</button></div>
    </section></div></section>`;
}
function makeStudentApp(input,{homeUrl='/PeninaPlus-vocab-builder/flash-cards/'}={}) {
    const deck=normalizeDeck(input);
    if(!/^\/(?!\/)/.test(homeUrl))homeUrl='/PeninaPlus-vocab-builder/flash-cards/';
    const serialized=JSON.stringify({deck,homeUrl}).replace(/</g,'\\u003c');
    let html=fs.readFileSync(path.join(app,'index.html'),'utf8');
    html=html.replace('<body>','<body data-student="true">')
        .replace(/<div class="bg-pattern"[^>]*><\/div>/,'')
        .replace(/<header class="app-header">[\s\S]*?<\/header>/,'')
        .replace('<nav class="workflow-nav"','<nav hidden class="workflow-nav"')
        .replace(/<section id="study-stage"[\s\S]*?(?=<section id="print-stage")/,studentStudyMarkup()+'\n');
    html=html.replace('<title>Penina Knowledge Builder</title>',`<title>${esc(deck.title)}</title>`);
    html=html.replace(/<link rel="stylesheet" href="knowledge-builder.css(?:\?[^\"]*)?">/,()=>`<style>${studyStyles()+'\n'+fs.readFileSync(path.join(app,'knowledge-student.css'),'utf8')}</style>`);
    const files={
        'cards.js':path.join(app,'cards.js'),
        'knowledge-builder.js':path.join(app,'knowledge-builder.js'),
        'knowledge-workflow.js':path.join(app,'knowledge-workflow.js'),
        '../PeninaPlus-vocab-builder/practice-exercises.js':path.join(app,'../PeninaPlus-vocab-builder/practice-exercises.js')
    };
    // Inline both data and runtime; downloaded student cards work without a server or teacher storage.
    html=html.replace('</head>',`<script id="peninaKnowledgeData" type="application/json">${serialized}</script></head>`);
    const scripts=[`window.PeninaStudyLayout={fitText:${fitText.toString()},classHomeButtonContent:${JSON.stringify(classHomeButtonContent())}};`];
    html=html.replace(/<script src="([^"?]+)(?:\?[^\"]*)?" defer><\/script>/g,(match,src)=>{
        if(!files[src])throw Error('Unexpected script in the knowledge student template.');
        scripts.push(fs.readFileSync(files[src],'utf8').replace(/<\/script/gi,'<\\/script'));return '';
    });
    const favicon=fs.readFileSync(path.join(app,'../PeninaPlus-vocab-builder/Penina-favicon.png')).toString('base64');
    html=html.replace(/\.\.\/PeninaPlus-vocab-builder\/Penina-favicon\.png/g,`data:image/png;base64,${favicon}`);
    return html.replace('</body>',()=>`${scripts.map(script=>`<script>${script}</script>`).join('\n')}</body>`);
}
module.exports={makeStudentApp};
