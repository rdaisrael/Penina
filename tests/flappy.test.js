const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const app=require('../PeninaPlus-vocab-builder/offline-study-cards');
const card={term:'סוס',english:'horse',alternativeAnswers:{english:{term:'סוס',definition:'horse',answers:['donkey','camel','goat','sheep']}}};
function harness(){
 const nodes=new Map(),listeners=new Map();let cancelled=false,payload;
 class Element{constructor(){this.children=[];this.style={};this.dataset={};this.classList={add(){},remove(){},toggle(){}};this.offsetLeft=60;this.offsetWidth=145;this.clientWidth=736;}querySelector(s){if(!nodes.has(s))nodes.set(s,new Element());return nodes.get(s);}querySelectorAll(){return [];}append(...c){this.children.push(...c);}setAttribute(){}addEventListener(){}focus(){}remove(){}}
 const board=new Element(),config=new Element();config.textContent=JSON.stringify({leaderboardUrl:'/api/game-scores?game=asteroids&grade=sixth'});
 const ctx={board,rows:app.practiceRows([card],'english'),AbortController,URL,crypto:{randomUUID:()=> 'flappy-test-run-123'},performance:{now:()=>0},localStorage:{getItem:()=>null,setItem(){}},document:{getElementById:()=>config,createElement:()=>new Element(),addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)},window:{location:{href:'https://example.com/class',protocol:'https:'},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{cancelled=true},fetch:async(url,options)=>{payload={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({scores:[{initials:'AB',score:100}]})};}};
 let source=app.mountFlappy.toString().replace('return ()=>{destroyed=true;', 'globalThis.control={start,question,resolve,submitScore,flap,laneAt,get:()=>({score,lives,answers,index,y,vy,readTime,state}),setSpeed:v=>{speed=v;}};return ()=>{destroyed=true;');
 vm.createContext(ctx);vm.runInContext('this.stop=('+source+')({board,rows});',ctx);
 return {ctx,control:ctx.control,get:s=>board.querySelector(s),listeners,cancelled:()=>cancelled,payload:()=>payload};
}
test('Flappy is included in class and standalone games with valid scripts and no sample words',()=>{for(const html of [app.makeApp('Test',[card]),app.makeClassGames('Class',[card])]){assert(html.includes('data-game="flappy"'));assert(!html.includes('waver'));for(const [,script]of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script);}});
test('Flappy uses approved definitions, speed rewards, penalties and three-life restart',()=>{const h=harness(),c=h.control;for(const speed of [1,2,3]){c.setSpeed(speed);c.start();assert.equal(h.get('#fv-clue').textContent,'סוס');assert.equal(c.get().answers.length,3);assert(c.get().answers.every(a=>['horse',...card.alternativeAnswers.english.answers].includes(a)));c.resolve(c.get().answers.indexOf('horse'));assert.equal(c.get().score,100*speed);}c.start();c.resolve(-1);assert.equal(c.get().score,-50);c.question();c.resolve(c.get().answers.findIndex(a=>a!=='horse'));c.question();c.resolve(-1);assert.equal(c.get().lives,0);assert.equal(c.get().score,-200);c.start();assert.equal(c.get().lives,3);assert.equal(c.get().score,0);});
test('Space works with other buttons focused and leaving removes all listeners',()=>{const h=harness();h.control.start();h.listeners.get('keydown')({code:'Space',target:{tagName:'BUTTON'},preventDefault(){},stopPropagation(){}});assert.equal(h.control.get().readTime,0);assert(Math.abs(h.control.get().vy**2/540-45)<.001);assert.equal(h.control.laneAt(111),-1);assert.equal(h.control.laneAt(0),0);assert.equal(h.control.laneAt(378),2);h.ctx.stop();assert(h.cancelled());assert.equal(h.listeners.size,0);});
test('Submit score sends initials and run score to the separate class leaderboard',async()=>{const h=harness();h.control.start();h.control.resolve(h.control.get().answers.indexOf('horse'));h.control.submitScore();const form=h.get('#fv-overlay').children.find(n=>n.className==='submission');form.children[0].value='ab';await form.onsubmit({preventDefault(){}});assert.equal(h.payload().body.score,100);assert.equal(h.payload().body.initials,'AB');assert(h.payload().url.includes('game=flappy'));assert(h.get('#fv-submit').disabled);});

test('Correct answers continue flying with unchanged height and momentum and no next-word overlay',()=>{
 const h=harness(),c=h.control;c.start();c.flap();const before=c.get();
 c.resolve(c.get().answers.indexOf('horse'));
 const after=c.get();assert.equal(after.index,1);assert.equal(after.score,100);assert.equal(after.state,'flight');
 assert.equal(after.y,before.y);assert.equal(after.vy,before.vy);assert.equal(after.readTime,0);
 assert.equal(h.get('#fv-overlay').hidden,true);assert.equal(h.get('#fv-flap').disabled,false);
 assert(h.get('#fv-feedback').textContent.startsWith('Correct! +100'));
 for(let i=1;i<5;i++)c.resolve(c.get().answers.indexOf('horse'));
 assert.equal(c.get().score,500);assert.equal(c.get().state,'over');assert.equal(h.get('#fv-overlay').hidden,false);
});
test('Wrong answers still pause for correction and do not skip vocabulary',()=>{
 const h=harness(),c=h.control;c.start();c.resolve(c.get().answers.findIndex(a=>a!=='horse'));
 assert.equal(c.get().state,'feedback');assert.equal(c.get().index,0);assert.equal(h.get('#fv-overlay').hidden,false);assert.equal(h.get('#fv-flap').disabled,true);
});
