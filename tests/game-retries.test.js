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
test('Cards start a second round before showing the final summary',()=>{
 const ctx={offset:3,rows:[1,2,3],mode:'cards',cardRound:1,matched:null,drag:null,clearSelection(){},board:{replaceChildren(){}},message(){},next:{},shuffle:rows=>rows.slice().reverse(),summary(){ctx.summaries++},summaries:0,updateProgress(){},matching(){ctx.matches++},matches:0,title:{focus(){}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('        function render()'),source.indexOf('        async function prepare('))+'render();',ctx);
 assert.equal(ctx.cardRound,2);assert.equal(ctx.offset,0);assert.equal(ctx.summaries,0);assert.equal(ctx.matches,1);
 ctx.offset=3;vm.runInContext('render()',ctx);assert.equal(ctx.summaries,1);
});
