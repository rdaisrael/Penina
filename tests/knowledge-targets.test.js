const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {normalizeDeck, pictureTargets} = require('../PeninaPlus-knowledge-builder/cards');
const study = require('../PeninaPlus-vocab-builder/offline-study-cards');
const sheets = require('../PeninaPlus-vocab-builder/vocabulary-sheets');
const vocab = require('../lib/quiz-vocabulary'), model = require('../lib/quiz-builder-model');
const targets = Array.from({length:5}, (_, i) => ({x:(i+1)/6, y:.3+i*.1}));
const picture = {src:'data:image/png;base64,YQ==',alt:'Diagram',target:targets[0],targets};
const deck = image => ({format:'penina-knowledge-cards',version:1,title:'Targets',cards:[{id:'one',question:'Identify A through E.',answer:'Five parts',picture:image}]});

test('zero through five targets round-trip; legacy single targets remain compatible and invalid coordinates are rejected', () => {
    const legacy = {src:picture.src,alt:picture.alt,target:{x:.2,y:.8}};
    assert.deepEqual(normalizeDeck(deck(legacy)).cards[0].picture, legacy);
    for (let count=0; count<=5; count++) {
        const input = deck({...picture,targets:targets.slice(0,count)});
        const output = normalizeDeck(JSON.parse(JSON.stringify(input)));
        assert.deepEqual(pictureTargets(output.cards[0].picture), targets.slice(0,count));
        assert.deepEqual(normalizeDeck(output), output);
        if(count) {
            output.cards[0].picture.target.x = .99;
            assert.equal(input.cards[0].picture.targets[0].x, targets[0].x, 'normalization does not share target objects with input');
        }
    }
    for (const invalid of [[...targets,targets[0]],null,{},[{x:-.1,y:.5}],[{x:.5,y:1.1}],[{x:NaN,y:0}],[null],[{x:'0.5',y:.5}]]) {
        assert.throws(() => normalizeDeck(deck({...picture,targets:invalid})), /target/);
    }
});

test('shared flashcards and sheets render every letter at its own relative position, keeping the single-target symbol', () => {
    const html = study.pictureMarkup(picture);
    assert.equal((html.match(/class="study-picture-target"/g)||[]).length, 5);
    for(const [i,letter] of [...'ABCDE'].entries()) {
        assert(html.includes(`aria-label="Target ${letter}"`));
        assert(html.includes(`left:${targets[i].x*100}%;top:${targets[i].y*100}%`));
        assert(html.includes(`>${letter}</span>`));
    }
    assert(study.pictureMarkup({...picture,targets:undefined}).includes('>＋</span>'));
    const table = sheets.renderTable(deck(picture).cards,{kind:'knowledge',context:true});
    assert.equal((table.match(/class="study-picture-target"/g)||[]).length,5);
    const texts=[],images=[],arcs=[];
    const ctx={scale(){},fillRect(){},strokeRect(){},measureText:text=>({width:text.length*7}),fillText:text=>texts.push(text),drawImage:(...args)=>images.push(args),beginPath(){},arc:(...args)=>arcs.push(args),fill(){},stroke(){},moveTo(){},lineTo(){}};
    const document={createElement:()=>({setAttribute(){},getContext:()=>ctx})};
    sheets.renderPages(document,{...deck(picture),options:{kind:'knowledge',context:true}},new Map([[picture.src,{naturalWidth:400,naturalHeight:200}]]));
    assert.equal(arcs.length,5);
    const [,left,top,width,height]=images[0];
    targets.forEach((target,i)=>{
        assert.equal(arcs[i][0],left+width*target.x);
        assert.equal(arcs[i][1],top+height*target.y);
        assert(texts.includes('ABCDE'[i]));
    });
});

test('quiz import, validation, duplication and student output retain all lettered targets', async () => {
    const rows=[{kind:'knowledge',word:'Identify A through E.',definition:'Five parts',picture,definitionDistractors:[]}];
    const questions=await vocab.questions({rows,types:['text'],autoCount:true});
    const quiz=model.validateQuiz({title:'Targets',questions},true);
    assert.deepEqual(quiz.questions[0].image.targets,targets);
    const publicQuestion=model.publicQuestions(quiz)[0];
    assert.deepEqual(publicQuestion.image.targets,targets);
    const api=vm.runInNewContext(fs.readFileSync(require.resolve('../Penina-Quizzes/picture.js'),'utf8')+'\nQuizPicture;', {structuredClone});
    assert.deepEqual(api.copyQuestion(quiz.questions[0]).image.targets,targets);
    const html=api.render(publicQuestion);
    assert.equal((html.match(/picture-marker lettered/g)||[]).length,5);
    assert(!html.includes('current question'));
    for(const letter of 'ABCDE')assert(html.includes(`>${letter}</span>`));
    for(const invalid of [[...targets,targets[0]],[{x:2,y:0}],[null],[]]) {
        const unsafe=structuredClone(quiz);unsafe.questions[0].image.targets=invalid;
        assert.throws(()=>model.validateQuiz(unsafe),/targets/);
    }
});

test('arrows round-trip with independent endpoints and reject invalid or zero-length geometry', () => {
    const arrow = {type:'arrow',x:.75,y:.6,tail:{x:.15,y:.2}};
    for (const image of [{...picture,target:arrow,targets:undefined},{...picture,targets:[targets[0],arrow]}]) {
        const result = normalizeDeck(deck(image));
        assert.deepEqual(pictureTargets(result.cards[0].picture),pictureTargets(image));
        assert.deepEqual(normalizeDeck(JSON.parse(JSON.stringify(result))),result);
        const copy = pictureTargets(result.cards[0].picture).at(-1);
        copy.tail.x = .9;
        assert.equal(arrow.tail.x,.15,'normalization copies the tail as well as the tip');
    }
    for (const invalid of [{...arrow,tail:null},{...arrow,tail:{x:2,y:0}},{...arrow,tail:{x:'0.1',y:.2}},{...arrow,tail:{x:.75,y:.6}},{...arrow,type:'unknown'}]) {
        assert.throws(()=>normalizeDeck(deck({...picture,target:invalid,targets:undefined})),/target/);
    }
});

test('shared sheets, games, quizzes and offline apps retain arrow geometry', async () => {
    const api = require('../PeninaPlus-knowledge-builder/cards');
    const arrow = {type:'arrow',x:.75,y:.6,tail:{x:.15,y:.2}};
    const image = {...picture,target:arrow,targets:[arrow,targets[1]]};
    const input = normalizeDeck(deck(image));
    const html = study.pictureMarkup(image);
    assert.match(html,/class="picture-arrow"/);
    assert.match(html,/x1="15%" y1="20%" x2="75%" y2="60%"/);
    assert.match(html,/aria-label="Arrow A"/);
    assert.match(html,/aria-label="Target B"/);
    const questions = await vocab.questions({rows:[{kind:'knowledge',word:'What is here?',definition:'Leaf',picture:image,definitionDistractors:[]}],types:['text'],autoCount:true});
    const quiz = model.validateQuiz({title:'Arrows',questions},true);
    assert.deepEqual(model.publicQuestions(quiz)[0].image.targets,image.targets);
    const renderer=vm.runInNewContext(fs.readFileSync(require.resolve('../Penina-Quizzes/picture.js'),'utf8')+'\nQuizPicture;',{structuredClone,PeninaKnowledgeCards:api});
    assert.match(renderer.render(model.publicQuestions(quiz)[0]),/aria-label="Arrow A"/);
    renderer.setMarker(quiz.questions,quiz.questions[0],{x:.8,y:.7},0);
    assert.deepEqual(JSON.parse(JSON.stringify(quiz.questions[0].image.targets[0])),{...arrow,x:.8,y:.7});
    const invalid=structuredClone(quiz);invalid.questions[0].image.targets[0].tail.x=-1;
    assert.throws(()=>model.validateQuiz(invalid),/targets/);
    const texts=[],lines=[],images=[];
    const ctx={save(){},restore(){},scale(){},fillRect(){},strokeRect(){},measureText:text=>({width:text.length*7}),fillText:text=>texts.push(text),drawImage:(...args)=>images.push(args),beginPath(){},arc(){},fill(){},stroke(){},moveTo:(...args)=>lines.push(args),lineTo:(...args)=>lines.push(args)};
    sheets.renderPages({createElement:()=>({setAttribute(){},getContext:()=>ctx})},{...input,options:{kind:'knowledge',context:true}},new Map([[image.src,{naturalWidth:400,naturalHeight:200}]]));
    const [,left,top,width,height]=images[0];
    assert(lines.some(([x,y])=>x===left+width*arrow.x&&y===top+height*arrow.y));
    assert(lines.some(([x,y])=>x===left+width*arrow.tail.x&&y===top+height*arrow.tail.y));
    assert(texts.includes('A'));
    const app=study.makeApp('Arrows',study.fromKnowledgeDeck(input));
    assert.match(app,/function arrowMarkup/);
    for(const match of app.matchAll(/<script>\n([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
});
