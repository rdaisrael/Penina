const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/offline-study-cards.js'),'utf8');
function quiz(){
 const element=(tag,text)=>({tag,textContent:text,children:[],disabled:false,classes:new Set(),classList:{add(value){this.owner.classes.add(value)}},append(...nodes){this.children.push(...nodes)},querySelectorAll(){return this.children},focus(){}});
 const make=(tag,text)=>{const node=element(tag,text);node.classList.owner=node;return node;};
 const rows=[0,1,2,3].map(id=>({id,term:'term'+id,definition:'answer'+id,answers:['wrongA','wrongB','wrongC','wrongD']}));
 const callbacks=[],ctx={rows,offset:0,score:0,attempts:0,locked:false,mastered:new Set(),board:make('div'),next:make('button'),shuffle:values=>values,element:make,button:(text,onclick)=>Object.assign(make('button',text),{onclick}),message:text=>{ctx.feedback=text},updateProgress(){},mistake:text=>{ctx.mistakeText=text||'Try again'},later:(fn,ms)=>callbacks.push({fn,ms}),render(){ctx.rendered=true}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('        function quiz()'),source.indexOf('        function match('))+'quiz();',ctx);
 return {ctx,choices:ctx.board.children[1].children,callbacks};
}
test('First quiz miss preserves the question and the second chance without revealing the answer',()=>{
 const {ctx,choices,callbacks}=quiz();choices[1].onclick();
 assert.equal(ctx.attempts,1);assert.equal(ctx.offset,0);assert.equal(ctx.mistakeText,'Try again');assert.equal(choices[1].disabled,true);assert.equal(choices[0].disabled,false);assert.equal(choices[0].classes.has('matched'),false);assert.equal(callbacks.length,0);
 choices[0].onclick();assert(ctx.mastered.has(0));assert.equal(ctx.attempts,2);assert.equal(ctx.rows.length,4);
});
test('Second miss queues the term after intervening questions and advances automatically, only once',()=>{
 const {ctx,choices,callbacks}=quiz();choices[1].onclick();choices[2].onclick();choices[3].onclick();
 assert.equal(ctx.attempts,2);assert.equal(ctx.rows.length,5);assert.equal(ctx.rows[3].id,0);assert.equal(callbacks.length,1);assert(choices[0].classes.has('matched'));
 callbacks[0].fn();assert.equal(ctx.offset,1);assert.equal(ctx.rendered,true);
});
test('Correct quiz answer advances automatically once after feedback',()=>{
 const {ctx,choices,callbacks}=quiz();choices[0].onclick();choices[0].onclick();
 assert.equal(ctx.attempts,1);assert.equal(callbacks.length,1);assert.equal(callbacks[0].ms,800);
 callbacks[0].fn();assert.equal(ctx.offset,1);assert.equal(ctx.rendered,true);
});
test('Matching finishes after the last batch without resetting the word pool',()=>{
 const ctx={offset:17,rows:Array.from({length:17},(_,i)=>i),mode:'cards',cardRound:3,matched:null,drag:null,clearSelection(){},board:{replaceChildren(){}},message(){},next:{},summary(){ctx.summaries++},summaries:0,updateProgress(){},matching(){throw new Error('Finished words repeated')},title:{focus(){}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('        function render()'),source.indexOf('        async function prepare('))+'render();',ctx);
 assert.equal(ctx.cardRound,3);assert.equal(ctx.offset,17);assert.equal(ctx.summaries,1);
});

test('An active matching run cannot be relaunched or sent back to the lobby in round two',async()=>{
 const ctx={matchingActive:true,cardRound:2,offset:4,matchingMistakes:1,stopPending(){throw new Error('Active game was restarted')},stopAsteroids:null};
 vm.createContext(ctx);
 const start=source.slice(source.indexOf('        function start(value)'),source.indexOf('        function menu()'));
 const prepare=source.slice(source.indexOf('        async function prepare(value)'),source.indexOf('        function start(value)'));
 vm.runInContext(start+prepare,ctx);
 vm.runInContext("start('cards')",ctx);await vm.runInContext("prepare('cards')",ctx);
 assert.equal(ctx.cardRound,2);assert.equal(ctx.offset,4);assert.equal(ctx.matchingMistakes,1);
});

test('Matching ends on the third mistake across all rounds and never restarts automatically',()=>{
 const first={row:{id:1,definition:'correct'},side:'term',node:{disabled:false}};
 const second={row:{id:2,definition:'wrong'},side:'definition',node:{disabled:false}};
 const again={hidden:true},ctx={first,second,locked:false,mode:'cards',matchingActive:true,matchingMistakes:0,attempts:0,matched:new Set(),matchingCount:6,cardRound:1,offset:0,startedAt:0,finishedMs:0,
 performance:{now:()=>1000},byId:()=>again,board:{replaceChildren(...nodes){ctx.finalBoard=nodes}},next:{hidden:true},element:(tag,text)=>({tag,text}),
 stopPending(){ctx.cancelled=true},clearSelection(){},updateProgress(){},message(text){ctx.feedback=text},mistake(){ctx.overlays=(ctx.overlays||0)+1}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('        function endMatchingAfterMistakes()'),source.indexOf('        function updateProgress()'))+source.slice(source.indexOf('        function match('),source.indexOf('        function choose(')),ctx);
 vm.runInContext('match(first,second)',ctx);assert.equal(ctx.matchingMistakes,1);assert.equal(ctx.matchingActive,true);
 ctx.cardRound=2;ctx.offset=3;
 vm.runInContext('match(first,second)',ctx);assert.equal(ctx.matchingMistakes,2);assert.equal(ctx.matchingActive,true);
 vm.runInContext('match(first,second)',ctx);assert.equal(ctx.matchingMistakes,3);assert.equal(ctx.matchingActive,false);assert.equal(ctx.cardRound,2);assert.equal(ctx.offset,3);
 assert.equal(ctx.overlays,2);assert(ctx.cancelled);assert.equal(again.hidden,false);assert.match(ctx.finalBoard[0].text,/Game over/);
 vm.runInContext('match(first,second)',ctx);assert.equal(ctx.attempts,3);assert.equal(ctx.matchingMistakes,3);
});

test('Twenty matching words advance through four batches exactly once, with continuous round numbering',()=>{
 const make=(tag,text,className='')=>({tag,textContent:text,className,children:[],disabled:false,classList:{add(){},remove(){}},setAttribute(){},append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this.children=nodes},focus(){},querySelectorAll(){return this.children.flatMap(node=>node.tag==='button'?[node]:node.querySelectorAll())}});
 const words=Array.from({length:20},(_,id)=>({id,term:'term'+id,definition:'answer'+id,answers:['wrongA','wrongB','wrongC','wrongD']}));
 const callbacks=[],rounds=[],completed=[];
 const ctx={rows:words,groups:{english:words},language:{value:'english'},mode:'cards',matchingActive:true,matchingMistakes:0,cardRound:1,offset:0,score:0,attempts:0,matched:new Set(),selected:null,drag:null,locked:false,matchingCount:0,startedAt:0,finishedMs:0,performance:{now:()=>1000},board:make('div'),next:make('button'),title:make('h2'),element:make,button:(text,onclick,className)=>Object.assign(make('button',text,className),{onclick}),shuffle:values=>values.slice(),message(){},updateProgress(){},clearSelection(){ctx.selected=null},later:(fn,ms)=>callbacks.push({fn,ms}),summary(){ctx.summaries=(ctx.summaries||0)+1},mistake(){throw new Error('Unexpected mistake')}};
 vm.createContext(ctx);
 const match=source.slice(source.indexOf('        function match('),source.indexOf('        function drawLine('));
 const matching=source.slice(source.indexOf('        function matching()'),source.indexOf('        async function prepare('));
 vm.runInContext(match+matching+'render();',ctx);
 while(!ctx.summaries){
  rounds.push(ctx.cardRound);
  const tiles=ctx.board.querySelectorAll(),terms=tiles.filter(node=>node.className==='game-tile game-term');
  for(const term of terms){const row=words.find(row=>row.term===term.textContent);completed.push(row.id);term.onclick();tiles.find(node=>node.textContent===row.definition).onclick();}
  const scheduled=callbacks.splice(0);assert.equal(scheduled.filter(item=>item.ms===450).length,1);scheduled.forEach(item=>item.fn());
 }
 assert.deepEqual(rounds,[1,2,3,4]);assert.deepEqual(completed,words.map(row=>row.id));assert.equal(ctx.offset,20);assert.equal(ctx.cardRound,4);assert.equal(ctx.summaries,1);assert(ctx.finishedMs>0);
});

test('Matching shuffles the original eligible pool instead of repeating the newest wordlists',()=>{
 const words=[{id:0,studyDate:'2026-10-07'},{id:1,studyDate:'2026-10-06'}];
 const ctx={value:'cards',groups:{english:words},language:{value:'english'},shuffle:rows=>rows.slice(),scheduleClassTerms(){throw new Error('Weighted repetition must not run for matching')}};
 vm.createContext(ctx);
 const line=source.split('\n').find(line=>line.includes('cardRound = 1; mode = value;'));
 vm.runInContext(line,ctx);assert.equal(ctx.rows.length,2);assert.equal(ctx.totalTerms,2);
});
