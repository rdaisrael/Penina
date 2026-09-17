const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const app = require('../PeninaPlus-vocab-builder/offline-study-cards');
const card = {term:'סוס',english:'horse',alternativeAnswers:{english:{term:'סוס',definition:'horse',answers:['donkey','camel','goat','sheep']}}};

function harness() {
    const nodes = new Map(), listeners = new Map();
    class Element {
        constructor() { this.children=[]; this.style={}; this.dataset={}; this.attributes={}; this.isConnected=true; }
        querySelector(selector) { if(!nodes.has(selector)) nodes.set(selector,new Element()); return nodes.get(selector); }
        querySelectorAll(selector) { return selector==='button'?this.children:[]; }
        append(node) { this.children.push(node); }
        replaceChildren() { this.children=[]; }
        setAttribute(key,value) { this.attributes[key]=value; }
        addEventListener() {} focus() {} remove() {}
    }
    const board = new Element();
    board.querySelector('canvas').getContext = () => new Proxy({}, {get:()=>()=>{}});
    let frame,clock=0,cancelled=false;
    const context = {board,rows:app.practiceRows([card],'english'), document:{hidden:false,createElement:()=>new Element(),addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},getComputedStyle:()=>({getPropertyValue:()=>'',color:'#123'}),requestAnimationFrame:fn=>{frame=fn;return 1},cancelAnimationFrame:()=>{cancelled=true}};
    vm.createContext(context);
    vm.runInContext('this.stop=('+app.mountChomp.toString()+')({board,rows});',context);
    const advance = seconds => {for(let i=0;i<Math.ceil(seconds*10);i++) {clock+=100;frame(clock);}};
    return {get:selector=>board.querySelector(selector),advance,context,listeners,isCancelled:()=>cancelled};
}

test('Gamify embeds Chomp with approved vocabulary and compiles the standalone scripts',()=>{
    const html=app.makeApp('Review',[card]);
    assert(html.includes('data-game="chomp"'));
    assert(!html.includes('Sample Hebrew word set'));
    for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
    assert(!app.makeApp('Review',[{term:'סוס',english:'horse'}]).includes('data-game="chomp"'));
});

test('Correct answer starts play immediately with eight seconds using saved distractors',()=>{
    const h=harness(),choices=h.get('.choices').children;
    assert.equal(h.get('.word').textContent,'סוס');
    assert.equal(h.get('#cc-tag').textContent,'Answer to Enter Maze');
    assert.equal(choices.length,4);
    assert(choices.every(b=>['horse',...card.alternativeAnswers.english.answers].includes(b.textContent)));
    choices.find(b=>b.textContent==='horse').onclick();
    assert.equal(h.get('.shade').hidden,true);
    assert.equal(h.get('#cc-seconds').textContent,'8 / 8s');
    assert.equal(h.get('#cc-accuracy').textContent,'1 / 1');
    h.get('#cc-pause').onclick();h.advance(3);
    assert.equal(h.get('#cc-seconds').textContent,'8 / 8s');
});

test('Wrong answer reveals correction for two seconds, ignores extra clicks, then resumes play',()=>{
    const h=harness(),choices=h.get('.choices').children;
    choices.find(b=>b.textContent!=='horse').onclick();
    choices.find(b=>b.textContent==='horse').onclick();
    assert.equal(h.get('.wrong-mark').hidden,false);
    assert.equal(h.get('.feedback').textContent,'Correct Answer is: horse');
    assert.equal(h.get('#cc-accuracy').textContent,'0 / 1');
    h.advance(1.9);assert.equal(h.get('.shade').hidden,false);
    h.advance(.1);assert.equal(h.get('.shade').hidden,true);
    assert.equal(h.get('#cc-seconds').textContent,'8 / 8s');
});

test('Leaving Chomp cancels its animation and removes the document listener',()=>{
    const h=harness();assert(h.listeners.has('visibilitychange'));
    h.context.stop();assert(h.isCancelled());assert(!h.listeners.has('visibilitychange'));
});
