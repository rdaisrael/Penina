const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {normalizeDeck,normalizeTextFormat,formattedTextHTML}=require('../PeninaPlus-knowledge-builder/cards');
const study=require('../PeninaPlus-vocab-builder/offline-study-cards');
const {knowledgeCards}=require('../lib/study-sets');
const {makeStudentApp}=require('../lib/knowledge-publication');
const {makeSheet,renderPages}=require('../PeninaPlus-vocab-builder/vocabulary-sheets');
const format={paragraphs:[{runs:[{text:'Which ',bold:false},{text:'answer?',bold:true}],direction:'rtl',align:'right'}]};
const fixture=()=>({format:'penina-knowledge-cards',version:1,title:'Formatting',cards:[{id:'c1',question:'Which answer?',answer:'Correct',additionalInformation:'Explain',textFormatting:{question:format,answer:{paragraphs:[{runs:[{text:'Correct',bold:true}],direction:'ltr',align:'left'}]}},distractors:{english:['Wrong A','Wrong B','Wrong C','Wrong D','Wrong E']}}]});
test('structured formatting round-trips without changing plain text or reviewed choices',()=>{
 const deck=normalizeDeck(fixture());assert.deepEqual(normalizeDeck(JSON.parse(JSON.stringify(deck))),deck);assert.deepEqual(deck.cards[0].textFormatting.question,format);
 for(const cards of [study.fromKnowledgeDeck(deck),knowledgeCards(deck).cards]){
  const row=study.practiceRows(cards,'english')[0];assert.equal(row.term,'Which answer?');assert.equal(row.definition,'Correct');assert.equal(row.answers.length,5);assert.deepEqual(row.questionFormatting,format);assert(!row.textFormatting);assert(!row.answerFormatting);
 }
});
test('formatting rejects mismatched text and unsafe style values, escaping all saved text',()=>{
 assert.equal(normalizeTextFormat('Changed',format),null);
 assert.equal(normalizeTextFormat('Which answer?',{paragraphs:[{runs:[{text:'Which\nanswer?'}]}]}),null);
 const dirty={paragraphs:[{runs:[{text:' <img onerror="alert(1)"> ',bold:true}],direction:'rtl" onclick="bad',align:'url(bad)'}]};
 const valid=normalizeTextFormat('<img onerror="alert(1)">',dirty);assert.equal(valid.paragraphs[0].direction,'auto');assert.equal(valid.paragraphs[0].align,'start');
 const html=formattedTextHTML('<img onerror="alert(1)">',valid);assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('<strong'));
 const changed=fixture();changed.cards[0].question='Changed';assert(!normalizeDeck(changed).cards[0].textFormatting.question);
});
test('standalone study, games, and sheets embed safe formatting renderers and compile offline',()=>{
 const deck=normalizeDeck(fixture());deck.cards[0].question='</script><img src=x>';deck.cards[0].textFormatting.question={paragraphs:[{runs:[{text:deck.cards[0].question,bold:true}],direction:'ltr',align:'left'}]};
 deck.cards[0].distractors.english=['One','Two','Three'];
 for(const html of [makeStudentApp(deck),study.makeApp(deck.title,study.fromKnowledgeDeck(deck)),study.makeClassGames(deck.title,study.fromKnowledgeDeck(deck)),makeSheet(deck.title,deck.cards,{kind:'knowledge'})]){
  assert(!html.includes('</script><img src=x>'));for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
 }
});
test('Live carries question formatting to both roles without revealing correct-answer styling or dropping the correct choice',async()=>{
 const h=require('./helpers/live-harness')();const pathname='knowledge-cards/sixth/formatted.json';h.storage.set(pathname,{body:JSON.stringify(fixture()),uploadedAt:new Date().toISOString()});
 const made=await h.create({pathnames:[pathname]});assert.equal(made.code,201);const {code,hostToken}=made.body;const joined=await h.join(code),student=joined.body.studentToken;
 assert.equal((await h.request('start',{code,version:0},hostToken)).code,200);
 for(const token of [hostToken,student]){const result=await h.request(null,{code},token);assert.equal(result.code,200);assert.deepEqual(JSON.parse(JSON.stringify(result.body.question.questionFormatting)),format);assert(result.body.question.options.includes('Correct'));assert.equal(result.body.question.options.length,4);assert(!('correct' in result.body.question));assert(!JSON.stringify(result.body.question.questionFormatting).includes('Correct'));}
});
test('knowledge PDF drawing preserves bold runs and paragraph direction',()=>{
 const draws=[];const ctx={scale(){},fillRect(){},strokeRect(){},measureText:text=>({width:Array.from(text).length*7}),fillText(text,x,y){draws.push({text,x,y,font:this.font,direction:this.direction});}};
 const document={createElement:()=>({setAttribute(){},getContext:()=>ctx})};const deck=normalizeDeck(fixture());
 const pages=renderPages(document,{...deck,options:{kind:'knowledge',context:true}});assert(pages.length);
 const ordinary=draws.find(item=>item.text==='Which '),bold=draws.find(item=>item.text==='answer?');assert(ordinary);assert(bold);assert.match(bold.font,/bold/);assert(!ordinary.font.includes('bold'));assert.equal(bold.direction,'rtl');assert(ordinary.x>bold.x);
 const answer=draws.find(item=>item.text==='Correct');assert.equal(answer.direction,'ltr');assert.match(answer.font,/bold/);
});
