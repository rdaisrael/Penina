const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../PeninaPlus-Reader/reader-core');
const html = fs.readFileSync(require.resolve('../PeninaPlus-Reader/index.html'), 'utf8');
const profile = {mode:'complete',words:['יֶלֶד','סֵפֶר'],verbs:[],nouns:[],adjs:[],forms:[]};
const entry = (word, mastered, translation, match='', form='') => ({word,mastered,translation,match,form});
const sample = {text:'הספר\nהילדים קוראים ספרים. קוראים.',words:[
    entry('הספר',true,'the book','ספר'),entry('הילדים',true,'the children','ילד'),entry('קוראים',false,'read'),entry('ספרים',true,'books','ספר'),entry('קוראים',false,'are reading')
]};

test('normalizes pointed vocabulary and preserves verb form restrictions', () => {
    assert.deepEqual(core.normalizeVocabulary(profile).words, ['ילד','ספר']);
    const verbProfile={...profile,mode:'pos',words:[],verbs:['קָרָא'],nouns:[],forms:['פעל שלם (כ-ת-ב)|הווה']};
    const data={text:'קורא\nקרא',words:[entry('קורא',true,'reads','קרא','פעל שלם (כ-ת-ב)|הווה'),entry('קרא',true,'read','קרא','פעל שלם (כ-ת-ב)|עבר')]};
    assert.deepEqual(core.validateAnalysis(data,verbProfile).words.map(w=>w.mastered),[true,false]);
    assert.deepEqual(core.validateAnalysis(data,{...verbProfile,forms:[]}).words.map(w=>w.mastered),[false,false]);
});

test('one analysis determines mastery and canonical repeated-word footnotes', () => {
    const validated=core.validateAnalysis(sample,profile);
    const result=core.buildResult('הַסֵּפֶר\nהַיְלָדִים קוֹרְאִים סְפָרִים. קוֹרְאִים.',validated);
    assert.deepEqual(result.words.map(w=>w.mastered),[true,true,false,true,false]);
    assert.deepEqual(result.words.map(w=>w.noteId),[null,null,1,null,1]);
    assert.equal(result.notes.length,1);
    assert.equal(result.notes[0].translation,'read; are reading');
    profile.words.push('חדש');
    assert.ok(!result.vocabulary.words.includes('חדש'));
    profile.words.pop();
});

test('rejects source rewrites, missing analysis, wrong word order and changed Dicta text', () => {
    assert.throws(()=>core.validateAnalysis(sample,profile,'הספר\nהילדה קוראת.'),/changed the supplied/);
    assert.throws(()=>core.validateAnalysis({...sample,words:sample.words.slice(1)},profile),/does not match/);
    assert.throws(()=>core.validateAnalysis({...sample,words:[sample.words[1],...sample.words.slice(1)]},profile),/Invalid word/);
    assert.throws(()=>core.buildResult('כותרת\nאחר',core.validateAnalysis(sample,profile)),/changed the source/);
    const source='הספר\nהילדים קוראים ספרים. קוראים.';
    assert.equal(core.validateAnalysis(sample,profile,source).text,source);
});

test('direct listed words recover missed or incorrect AI matches', () => {
    const data={text:'ילד\nספר',words:[entry('ילד',true,'child','מומצא'),entry('ספר',false,'book','ספר')]};
    assert.deepEqual(core.validateAnalysis(data,profile).words.map(w=>w.mastered),[true,true]);
    assert.deepEqual(core.validateAnalysis(data,profile).words.map(w=>w.match),['ילד','ספר']);
});

test('exact matches ignore nikkud, repeat consistently, and receive bold and color', () => {
    const data={text:'סֵפֶר\nספר ספר',words:[
        entry('סֵפֶר',false,'book'),entry('ספר',true,'book','ספר'),entry('ספר',false,'book')
    ]};
    for (const vocabulary of [profile,{...profile,mode:'upload',words:[],nouns:['סֵפֶר']}]) {
        const result=core.buildResult(data.text,core.validateAnalysis(data,vocabulary));
        assert.deepEqual(result.words.map(w=>w.mastered),[true,true,true]);
        assert.equal(result.notes.length,0);
        const output=renderer({'bold-words':{checked:true},'highlight-words':{checked:true}}).formatStory(result.text,result.words);
        assert.ok(output.includes('font-weight: bold'));
        assert.ok(output.includes('color: #123456'));
    }
});

test('direct matching does not guess prefixes, plurals, unknown words or verb forms', () => {
    const data={text:'הספר\nספרים חדש',words:[
        entry('הספר',false,'the book'),entry('ספרים',false,'books'),entry('חדש',true,'new','invented')
    ]};
    assert.deepEqual(core.validateAnalysis(data,profile).words.map(w=>w.mastered),[false,false,false]);
    const verbs={...profile,mode:'upload',words:[],verbs:['כתב'],forms:['פעל שלם|עבר']};
    for (const [match,form,expected] of [['','',false],['כתב','',false],['כתב','פעל שלם|עתיד',false],['כתב','פעל שלם|עבר',true]]) {
        const data={text:'כתב\nכתב',words:[entry('כתב',false,'wrote',match,form),entry('כתב',false,'wrote',match,form)]};
        assert.deepEqual(core.validateAnalysis(data,verbs).words.map(w=>w.mastered),[expected,expected]);
    }
});

test('an unmastered expression still overrides recovered individual matches', () => {
    const vocabulary={...profile,mode:'upload',words:[],nouns:['בית','ספר']};
    const data={text:'בית\nבית ספר',words:[
        entry('בית',false,'house'),entry('בית',false,'school'),entry('ספר',false,'school')
    ],phrases:[{start:1,end:3,word:'בית ספר',mastered:false,translation:'school',match:'',form:''}]};
    const result=core.buildResult(data.text,core.validateAnalysis(data,vocabulary));
    assert.deepEqual(result.words.map(w=>w.mastered),[true,false,false]);
    assert.equal(result.notes.length,1);
    assert.equal(result.notes[0].translation,'school');
});

function renderer(settings={}) {
    const fields={};
    const context=vm.createContext({AbortSignal,ReaderCore:core,document:{getElementById(id){return fields[id] ||= {checked:false,value:id==='font-choice'?'Arial':'#123456',...settings[id]};}}});
    vm.runInContext(html.slice(html.indexOf('        function processTextChunk'),html.indexOf('        function applyStyles')),context);
    return context;
}
test('mastered inflections share their footnote decision; font choice never enlarges them', () => {
    const result=core.buildResult(sample.text,core.validateAnalysis(sample,profile));
    const ctx=renderer({'bold-words':{checked:true}});
    const output=ctx.formatStory(result.text,result.words);
    assert.equal((output.match(/footnote-marker/g)||[]).length,2);
    assert.ok(output.includes('font-weight: bold'));
    const dyslexic=renderer({'font-choice':{value:'Dyslexic-Kriah'}}).formatStory(result.text,result.words);
    assert.ok(!dyslexic.includes('font-weight: bold'));
    assert.ok(!dyslexic.includes('font-size: calc(1em + 15px);\"><span'));
});
test('story and raw token renderers escape external markup', () => {
    const ctx=renderer();
    assert.ok(ctx.processTextChunk('<img/src=x>',[],false).includes('&lt;img/src=x&gt;'));
    const output=ctx.formatStory('<img src=x>\nשלום & <script>alert(1)</script>',[]);
    assert.ok(!output.includes('<img')); assert.ok(!output.includes('<script>'));
    assert.ok(output.includes('&lt;script&gt;'));
});
test('worksheet validation requires exact count, consecutive numbering and answer lines', () => {
    const valid='<img src=x>\n1. שאלה?\n[LINE]\n[LINE]\n2. עוד?\n[LINE]\n[LINE]';
    assert.equal(core.validateWorksheet(valid,2).questions.length,2);
    assert.throws(()=>core.validateWorksheet(valid,3),/question count/);
    assert.throws(()=>core.validateWorksheet(valid.replace('2.','3.'),2),/question count/);
    assert.throws(()=>core.validateWorksheet(valid.replace('[LINE]\n',''),2),/answer lines/);
    assert.throws(()=>core.validateWorksheet(valid+'\nAn extra answer',2),/formatting/);
    assert.equal(core.escapeHtml(core.validateWorksheet(valid,2).title),'&lt;img src=x&gt;');
});
test('a new story invalidates old worksheets; a newer worksheet invalidates an older one', () => {
    const tracker=core.createRequestTracker();
    const firstStory=tracker.beginStory(), old=tracker.beginWorksheet();
    const newer=tracker.beginWorksheet();
    assert.equal(tracker.isWorksheet(old),false);
    assert.equal(tracker.isWorksheet(newer),true);
    tracker.beginStory();
    assert.equal(tracker.isWorksheet(newer),false);
    assert.equal(tracker.isStory(firstStory),false);
});
test('rerender uses saved analysis without reading current vocabulary controls', () => {
    const result=core.buildResult(sample.text,core.validateAnalysis(sample,profile));
    const output={innerHTML:'',classList:{remove(){}}};
    const context=vm.createContext({AbortSignal,ReaderCore:core,currentRawStory:result.text,currentResult:result,currentFootnotes:'<img src=x>',
        document:{getElementById(id){assert.equal(id,'story-output');return output;},querySelector(){return {value:'end'};}},
        formatStory(text,words){assert.equal(words,result.words);return 'STORY';},applyStyles(){},applyFootnoteSettings(){}});
    vm.runInContext(html.slice(html.indexOf('        function renderStoryToScreen'),html.indexOf('        function processTextChunk')),context);
    context.renderStoryToScreen();
    assert.ok(output.innerHTML.includes('&lt;img src=x&gt;'));
});
test('full inline reader script is syntactically valid', () => {
    new vm.Script(html.slice(html.indexOf('    <script>')+12,html.lastIndexOf('</script>')));
});

test('structured reader endpoint validates analysis before Dicta and sends only source text', async () => {
    for (const invalid of [false,true]) {
        let dictaCalls=0, result, status;
        const context=vm.createContext({AbortSignal,module:{exports:{}},process:{env:{DICTA_API_KEY:'test-only'}},
            require(name) {
                if(name==='../lib/reader-response')return require('../lib/reader-response');
                if(name==='../lib/dicta-nikkud')return require('../lib/dicta-nikkud');
                if(name==='../lib/openai-text')return {generateOpenAIText:async (prompt,options)=>{
                    assert.equal(options.textFormat.type,'json_schema');
                    assert.equal(options.textFormat.strict,true);
                    assert.ok(prompt.includes('EVERY Hebrew word'));
                    return JSON.stringify(invalid?{...sample,text:'אחר\nלגמרי'}:sample);
                }};
                throw new Error(name);
            },
            fetch:async (_,options)=>{
                dictaCalls++;
                assert.equal(JSON.parse(options.body).data,sample.text);
                return {ok:true,json:async()=>({data:[{str:sample.text,sep:true}]})};
            }
        });
        vm.runInContext(fs.readFileSync(require.resolve('../api/generate'),'utf8'),context);
        await context.module.exports({method:'POST',body:{prompt:'Analyze this story',sourceText:sample.text,readerVocabulary:profile}},
            {status(code){status=code;return this;},json(data){result=data;}});
        assert.equal(status,invalid?500:200);
        assert.equal(dictaCalls,invalid?0:1);
        if(!invalid)assert.equal(result.readerResult.notes.length,1);
    }
});

test('late worksheet response cannot attach to a newly requested story', async () => {
    const fields=new Map(),listeners=new Map();
    function field(id){
        if(!fields.has(id))fields.set(id,{value:'',checked:false,disabled:false,innerHTML:'ORIGINAL',innerText:'',textContent:'',style:{},
            addEventListener(event,fn){listeners.set(id+':'+event,fn);},scrollIntoView(){}});
        return fields.get(id);
    }
    field('questions-lang').value='English';field('question-count').value='1';
    field('theme').value='ספר';field('pathway-a-radio').checked=true;
    field('length').value='one paragraph';field('reading-level').value='beginner';
    let finishWorksheet;
    const tracker=core.createRequestTracker();
    const context=vm.createContext({AbortSignal,ReaderCore:core,requests:tracker,storyPending:false,lockQuestionOptions:()=>{},worksheetAbort:null,currentRawStory:sample.text,
        readerDictaOptions:{keepqq:true},AbortController,console:{error(){}},alert(){},
        document:{getElementById:field,querySelector(){return {style:{}};}},
        toggleLayoutLock(){},clearLineNumbers(){},showWorksheetPrintControls(){throw new Error('Stale worksheet became printable');},
        getVocabularyPromptInstructions(){return {profile,vocabPrompt:'',rulePrompt:''};},
        parseAndRenderOutput(){},
        fetch:async (url,options)=>{
            const body=JSON.parse(options.body);
            if(!body.readerVocabulary)return new Promise(resolve=>{finishWorksheet=()=>resolve({json:async()=>({text:'Title\n1. Question?\n[LINE]\n[LINE]'})});});
            assert.equal(body.dictaGenre,'modern');
            throw new Error('Simulated new story failure');
        }
    });
    vm.runInContext(html.slice(html.indexOf("        document.getElementById('generate-btn').addEventListener"),html.indexOf('        function parseAndRenderOutput')),context);
    vm.runInContext(html.slice(html.indexOf("        document.getElementById('generate-questions-btn').addEventListener"),html.indexOf('        // Initialize the Verb Matrices')),context);
    const pending=listeners.get('generate-questions-btn:click')();
    await listeners.get('generate-btn:click')();
    finishWorksheet();await pending;
    assert.equal(field('questions-output').innerHTML,'ORIGINAL');
    assert.equal(field('story-output').innerHTML,'ORIGINAL');
    assert.ok(field('reader-status').textContent.includes('Simulated new story failure'));
});

test('Dicta layout normalization cannot change the source paragraph breaks or punctuation', () => {
    const result=core.buildResult('הַסֵּפֶר הַיְלָדִים קוֹרְאִים סְפָרִים קוֹרְאִים',core.validateAnalysis(sample,profile));
    assert.equal(core.skeleton(result.text),sample.text);
    assert.equal(result.text.split('\n').length,2);
    assert.equal((result.text.match(/\./g)||[]).length,2);
});

test('standard pointed spelling requires Dicta evidence for each exact source token', () => {
    const data={text:'סיפורים\nסיפורים',words:[entry('סיפורים',false,'stories'),entry('סיפורים',false,'stories')]};
    const analysis=core.validateAnalysis(data,profile);
    const tokens=[{str:'סיפורים',nakdan:{options:[{w:'סִפּוּרִים'}]}},{str:'\n',sep:true},{str:'סיפורים',nakdan:{options:[{w:'סִפּוּרִים'}]}}];
    assert.throws(()=>core.buildResult('סִפּוּרִים\nסִפּוּרִים',analysis),/changed the source word/);
    const result=core.buildResult('סִפּוּרִים\nסִפּוּרִים',analysis,tokens);
    assert.equal(result.sourceText,data.text);
    assert.equal(result.spellingChanges.length,2);
    assert.equal(result.notes.length,1);
    assert.throws(()=>core.buildResult('דִפּוּרִים\nסִפּוּרִים',analysis,[{str:'סיפורים',nakdan:{options:[{w:'דִפּוּרִים'}]}},tokens[1],tokens[2]]),/changed the source word/);
});

test('grammatical prefixes share one note in either order, including combined prefixes', () => {
    for (const forms of [
        [['ספר',''],['לספר','ל'],['בספר','ב'],['שספר','ש'],['הספר','ה'],['שבספר','שב']],
        [['שבספר','שב'],['הספר','ה'],['בספר','ב'],['לספר','ל'],['ספר','']]
    ]) {
        const text=forms[0][0]+'\n'+forms.slice(1).map(([word])=>word).join(' ');
        const data={text,words:forms.map(([word,prefix],i)=>({...entry(word,false,i===0?'book':'the book'),prefix}))};
        const result=core.buildResult(text,core.validateAnalysis(data,{...profile,words:["ילד"]}));
        assert.equal(result.notes.length,1);
        assert.deepEqual(result.words.map(w=>w.noteId),forms.map(()=>1));
        assert.equal(result.notes[0].translation,'book; the book');
        assert.equal(result.notes[0].word,forms[0][0]);
    }
});

test('lexical initial letters and other inflections remain distinct from prefix variants', () => {
    const forms=[['הַר',''],['הָהָר','ה'],['בַּר',''],['שָׁמַר',''],['מַר',''],['בַּיִת',''],['לַבַּיִת','ל'],['סְפָרִים',''],['סֵפֶר',''],['לוֹמֵד','']];
    const text=forms[0][0]+'\n'+forms.slice(1).map(([word])=>word).join(' ');
    const data={text,words:forms.map(([word,prefix])=>({...entry(word,false,'gloss'),prefix}))};
    const result=core.buildResult(text,core.validateAnalysis(data,{...profile,words:["ילד"]}));
    assert.deepEqual(result.words.map(w=>w.noteId),[1,1,2,3,4,5,5,6,7,8]);
});

test('unusable prefix metadata preserves the full word without stopping generation', () => {
    for (const prefix of ['ס','לב','ספר',null,7]) {
        const data={text:'ספר\nספר',words:[{...entry('ספר',false,'book'),prefix},entry('ספר',false,'book')]};
        const result=core.buildResult(data.text,core.validateAnalysis(data,{...profile,words:[]}));
        assert.equal(result.words[0].prefix,'');
        assert.equal(result.text,data.text);
        assert.equal(result.words[0].noteId,result.words[1].noteId);
    }
    const {readerFormat,readerPrompt}=require('../lib/reader-response');
    assert.ok(readerFormat.schema.properties.words.items.required.includes('prefix'));
    assert.ok(readerPrompt('Read',profile).includes('never letters belonging to the lexical word'));
});

const phraseEntry = (start,end,word,translation,mastered=false,match='',form='') => ({start,end,word,translation,mastered,match,form});
function phraseSample() {
    return {text:'טיול\nגן החיות בגן החיות גן',words:[
        entry('טיול',true,'trip','טיול'),entry('גן',true,'garden','גן'),
        {...entry('החיות',true,'the animals','חיות'),prefix:'ה'},
        {...entry('בגן',true,'in the garden','גן'),prefix:'ב'},
        {...entry('החיות',true,'the animals','חיות'),prefix:'ה'},entry('גן',false,'garden')
    ],phrases:[phraseEntry(1,3,'גן החיות','zoo'),phraseEntry(3,5,'בגן החיות','at the zoo')]};
}
const phraseProfile={mode:'complete',words:['טיול','גן','חיות'],verbs:[],nouns:[],adjs:[],forms:[]};

test('vocabulary preserves phrase boundaries, niqqud normalization and maqaf equivalents', () => {
    const p=core.normalizeVocabulary({...phraseProfile,words:['גַּן הַחַיּוֹת','גן   החיות','בית־ספר','בית ספר','גןהחיות']});
    assert.deepEqual(p.words,['גן החיות','בית ספר','גןהחיות']);
    assert.deepEqual(core.normalizeVocabulary(p),p);
});

test('repeated prefix variants get one phrase note, a final-word marker and independent standalone notes', () => {
    const data=phraseSample();
    const pointed='טִיּוּל\nגַּן הַחַיּוֹת בְּגַן הַחַיּוֹת גַּן';
    const result=core.buildResult(pointed,core.validateAnalysis(data,{...phraseProfile,words:["טיול"]}));
    assert.deepEqual(result.words.map(w=>w.noteId),[null,null,1,null,1,2]);
    assert.deepEqual(result.words.map(w=>w.mastered),[true,false,false,false,false,false]);
    assert.equal(result.notes[0].word,'גַּן הַחַיּוֹת');
    assert.equal(result.notes[0].translation,'zoo; at the zoo');
    assert.equal(result.notes[1].translation,'garden');
    const rendered=renderer().formatStory(result.text,result.words);
    assert.equal((rendered.match(/footnote-marker/g)||[]).length,3);
});

test('whole-phrase mastery requires a listed phrase and cannot leak into individual words', () => {
    const data=phraseSample();
    data.phrases=data.phrases.map(p=>({...p,mastered:true,match:'גן החיות'}));
    assert.equal(core.validateAnalysis(data,phraseProfile).phrases[0].mastered,false);
    const known={...phraseProfile,words:['טיול','גן החיות']};
    const result=core.buildResult(data.text,core.validateAnalysis(data,known));
    assert.deepEqual(result.words.map(w=>w.mastered),[true,true,true,true,true,false]);
    assert.equal(result.notes.length,1);
    const single={text:'גן\nחיות',words:[entry('גן',true,'garden','גן החיות'),entry('חיות',true,'animals','גן החיות')]};
    assert.deepEqual(core.validateAnalysis(single,known).words.map(w=>w.mastered),[false,false]);
});

test('phrase validation rejects fabricated spans, overlaps and punctuation or paragraph crossings', () => {
    for (const patch of [{start:-1},{start:1.5},{end:99},{end:2},{word:'בית ספר'},{translation:''},{mastered:'yes'}]) {
        const data=phraseSample();data.phrases=[{...data.phrases[0],...patch}];
        assert.throws(()=>core.validateAnalysis(data,phraseProfile),/phrase|Phrase/);
    }
    const overlap=phraseSample();overlap.phrases.push(overlap.phrases[0]);
    assert.throws(()=>core.validateAnalysis(overlap,phraseProfile),/Overlapping/);
    for(const separator of [', ','. ','\n','\n\n','! ']) {
        const data=phraseSample();data.text=data.text.replace('גן החיות','גן'+separator+'החיות');
        assert.throws(()=>core.validateAnalysis(data,phraseProfile),/boundary/);
    }
    const title=phraseSample();title.phrases=[phraseEntry(0,2,'טיול גן','trip garden')];
    assert.throws(()=>core.validateAnalysis(title,phraseProfile),/boundary/);
});

test('ordinary combinations remain individual words and legacy analyses still render', () => {
    const data={text:'בית\nבית גדול',words:[entry('בית',false,'house'),entry('בית',false,'house'),entry('גדול',false,'big')],phrases:[]};
    const result=core.buildResult(data.text,core.validateAnalysis(data,phraseProfile));
    assert.deepEqual(result.words.map(w=>w.noteId),[1,1,2]);
    delete data.phrases;
    assert.deepEqual(core.buildResult(data.text,core.validateAnalysis(data,phraseProfile)),result);
});

test('phrase verbs respect selected forms, and generation requires explicit conservative phrase analysis', () => {
    const data=phraseSample();data.phrases=[{...data.phrases[0],mastered:true,match:'גן החיות',form:'allowed'}];
    const p={...phraseProfile,mode:'pos',verbs:['גן החיות'],forms:[]};
    assert.equal(core.validateAnalysis(data,p).phrases[0].mastered,false);
    assert.equal(core.validateAnalysis(data,{...p,forms:['allowed']}).phrases[0].mastered,true);
    const {readerFormat,readerPrompt}=require('../lib/reader-response');
    assert.ok(readerFormat.schema.required.includes('phrases'));
    const prompt=readerPrompt('Read',phraseProfile);
    assert.ok(prompt.includes('leave uncertain expressions ungrouped'));
    assert.ok(prompt.includes('counting title words'));
});

test('section questions are distributed through paragraphs with whole-story review at the end', () => {
    const paragraph = ('הילד ראה את הספר וקרא בו בשמחה עם חבר בבית. ').repeat(5).trim();
    const story = 'כותרת\n' + [paragraph,paragraph,paragraph].join('\n\n');
    const plan=core.worksheetPlan(story,5);
    assert.deepEqual(plan.sections,[paragraph,paragraph,paragraph]);
    assert.deepEqual(plan.targets,[1,2,3,0,0]);
    assert.deepEqual(core.worksheetPlan(story,2).targets,[2,0]);
    assert.deepEqual(core.worksheetPlan('כותרת\nפסקה אחת',5).targets,[0,0,0,0,0]);
    const text='Title\n'+plan.targets.map((n,i)=>`${i+1}. [SECTION ${n}] Question?\n[LINE]\n[LINE]`).join('\n');
    const worksheet=core.validateWorksheet(text,5,plan.targets);
    assert.deepEqual(worksheet.questions.map(q=>q.section),plan.targets);
    assert.equal(worksheet.questions[0].text,'Question?');
    assert.throws(()=>core.validateWorksheet(text.replace('[SECTION 1]','[SECTION 2]'),5,plan.targets),/placement/);
    assert.throws(()=>core.validateWorksheet(text.replace('[SECTION 1] ',''),5,plan.targets),/placement/);
});

test('interleaved rendering preserves token analysis and inserts questions after the relevant section', () => {
    const data={text:'ספר\nספר\n\nילד',words:[entry('ספר',false,'book'),entry('ספר',false,'book'),entry('ילד',true,'child','ילד')]};
    const result=core.buildResult(data.text,core.validateAnalysis(data,{...profile,words:["ילד"]}));
    const output=renderer().formatStory(result.text,result.words,n=>`<aside>QUESTION ${n}</aside>`);
    assert.equal((output.match(/footnote-marker/g)||[]).length,2);
    assert.equal((output.match(/worksheet-reading-section/g)||[]).length,2);
    assert.ok(output.indexOf('QUESTION 1') < output.indexOf('QUESTION 2'));
});

test('names and prefixed names are not footnoted, without granting vocabulary mastery', () => {
    const data={text:'דוד\nלדוד דוד ורד',words:[
        {...entry('דוד',false,'David'),isName:true},
        {...entry('לדוד',false,'to David'),isName:true,prefix:'ל'},
        {...entry('דוד',false,'uncle'),isName:false},
        {...entry('ורד',false,'rose'),isName:false}
    ]};
    const result=core.buildResult(data.text,core.validateAnalysis(data,{...profile,words:[]}));
    assert.deepEqual(result.words.map(w=>w.noteId),[null,null,1,2]);
    assert.deepEqual(result.words.map(w=>w.mastered),[false,false,false,false]);
    assert.deepEqual(result.notes.map(n=>n.translation),['uncle','rose']);
});

test('multiword proper names are excluded, while ordinary compound vocabulary is footnoted', () => {
    for (const phraseFlag of [false,true]) {
        const data={text:'טיול\nתל אביב גן החיות',words:[
            entry('טיול',true,'trip','טיול'),
            {...entry('תל',false,'Tel'),isName:!phraseFlag},
            {...entry('אביב',false,'Aviv'),isName:!phraseFlag},
            entry('גן',false,'garden'),entry('החיות',false,'animals')
        ],phrases:[{...phraseEntry(1,3,'תל אביב','Tel Aviv'),isName:phraseFlag},phraseEntry(3,5,'גן החיות','zoo')]};
        const result=core.buildResult(data.text,core.validateAnalysis(data,phraseProfile));
        assert.deepEqual(result.words.map(w=>w.noteId),[null,null,null,null,1]);
        assert.equal(result.notes[0].translation,'zoo');
        assert.equal((renderer().formatStory(result.text,result.words).match(/footnote-marker/g)||[]).length,1);
    }
});

test('name metadata is strictly boolean, required for new generation, and optional for older analyses', () => {
    for (const value of ['false',null,1]) {
        const data=phraseSample();data.words[0].isName=value;
        assert.throws(()=>core.validateAnalysis(data,phraseProfile),/word name analysis/);
        delete data.words[0].isName;data.phrases[0].isName=value;
        assert.throws(()=>core.validateAnalysis(data,phraseProfile),/phrase name analysis/);
    }
    const {readerFormat,readerPrompt}=require('../lib/reader-response');
    assert.ok(readerFormat.schema.properties.words.items.required.includes('isName'));
    assert.ok(readerFormat.schema.properties.phrases.items.required.includes('isName'));
    assert.ok(readerPrompt('Read',profile).includes('דוד meaning uncle is not'));
    const result=core.buildResult(sample.text,core.validateAnalysis(sample,profile));
    assert.equal(result.notes.length,1);
});

test('personal and possessive pronouns and את are understood without model approval', () => {
    const text='אני\nאֶת אַתְּ שלי שלך שלהם ספר.';
    const data={text,words:core.words(text).map(([word])=>entry(word,false,'meaning'))};
    const result=core.buildResult(text,core.validateAnalysis(data,{...profile,words:[]}));
    assert.deepEqual(result.words.map(w=>w.mastered),[true,true,true,true,true,true,false]);
    assert.equal(result.notes.length,1);
    assert.equal(result.notes[0].word,'ספר');
});

test('pointed prefix metadata is normalized without stripping lexical letters', () => {
 const text='בספר\nספר';
 const data={text,words:[{...entry('בספר',false,'in a book'),prefix:' בְּ '},entry('ספר',false,'book')]};
 const result=core.buildResult(text,core.validateAnalysis(data,{...profile,words:[]}));
 assert.equal(result.words[0].prefix,'ב');
 assert.equal(result.words[0].noteId,result.words[1].noteId);
});

test('two-page length counts Hebrew story words, excluding title and worksheet space', () => {
    assert.equal(core.storyLengthPlan('2-page').minWords,600);
    assert.equal(core.storyLengthPlan('2 pages').minWords,600);
    assert.equal(core.storyLengthPlan('1-page').minWords,300);
    assert.equal(core.storyLengthPlan('3-paragraph').minWords,150);
    assert.throws(()=>core.validateStoryLength('כותרת\n'+ 'ילד '.repeat(204),'2-page'),/too short/);
    assert.throws(()=>core.validateStoryLength('ילד '.repeat(600)+'\nילד','2-page'),/too short/);
    core.validateStoryLength('כותרת\n'+'ילד '.repeat(600),'2-page');
});

test('questions follow substantial reading passages and retain all words in order', () => {
    const sentence='הילד ראה את הספר וקרא בו בשמחה עם חבר בבית.';
    const story='כותרת\n'+Array(15).fill(sentence).join('\n\n');
    const plan=core.worksheetPlan(story,15);
    assert.equal(plan.targets.length,15);
    assert.ok(plan.sections.length > 1);
    for(const passage of plan.sections) {
        assert.ok(core.words(passage).length >= 40);
        assert.ok((passage.match(/\./g)||[]).length >= 3);
    }
    assert.deepEqual(core.words(plan.sections.join(' ')).map(x=>x[0]),core.words(story.split('\n').slice(1).join(' ')).map(x=>x[0]));
});

test('word-count ranges enforce both boundaries and exclude the title', () => {
    for (const [length,min,max] of [['100-200 words',100,200],['201-400 words',201,400],['401-600 words',401,600],['37 words',37,37]]) {
        const plan=core.storyLengthPlan(length);
        assert.equal(plan.minWords,min);
        assert.equal(plan.maxWords,max);
        assert.ok(plan.instruction.includes(`${min}–${max} Hebrew words`));
        const story=count=>'כותרת ארוכה\n'+'ילד '.repeat(count);
        core.validateStoryLength(story(min),length);
        core.validateStoryLength(story(max),length);
        assert.throws(()=>core.validateStoryLength(story(min-1),length),/too short/);
        assert.throws(()=>core.validateStoryLength(story(max+1),length),/too long/);
    }
});
