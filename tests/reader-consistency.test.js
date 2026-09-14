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

test('fabricated vocabulary and ambiguous/unknown decisions never become mastered', () => {
    const data={text:'ילד\nספר',words:[entry('ילד',true,'child','מומצא'),entry('ספר',false,'book','ספר')]};
    assert.deepEqual(core.validateAnalysis(data,profile).words.map(w=>w.mastered),[false,false]);
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
    const output={innerHTML:''};
    const context=vm.createContext({AbortSignal,ReaderCore:core,currentRawStory:result.text,currentResult:result,currentFootnotes:'<img src=x>',
        document:{getElementById(id){assert.equal(id,'story-output');return output;}},
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
    const context=vm.createContext({AbortSignal,ReaderCore:core,requests:tracker,storyPending:false,worksheetAbort:null,currentRawStory:sample.text,
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
