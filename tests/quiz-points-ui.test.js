const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Dashboard opens the denominator editor, totals changes, saves its revision, and keeps errors visible',async()=>{
 const elements=new Map(),calls=[];
 function element(tag){return {tag,children:[],value:'',textContent:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(k,v){this[k]=v;},addEventListener(){},reset(){},reportValidity(){return true;},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(selector){return this.children.flatMap(c=>[...((selector==='input' && c.type==='number' || selector==='select' && c.tag==='select')?[c]:[]),...c.querySelectorAll(selector)]);}};}
 const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 let fail=false;
 const quiz={id:'custom-test',title:'Quiz <one>',revision:3,questions:[{prompt:'Explain <this>',potentialPoints:4,responseCount:3,extraCredit:false},{prompt:'Bonus',potentialPoints:2,extraCredit:true}]};
 const context={URL,location:{href:'https://www.penina-hebrew.org/Penina-Quizzes/teacher/'},document:{getElementById:$,createElement:element},fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return {ok:!fail,json:async()=>fail?{error:'Close and reopen the editor'}:{...quiz,revision:body.action==='save-points'?4:3}};}};
 const source=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/teacher/teacher.js'),'utf8');
 vm.runInNewContext("const $=id=>document.getElementById(id);let assignments=[{quiz:'custom-test',title:'Quiz',className:'Class',courseId:'course',classId:'class',state:'PUBLISHED'}];"+source.slice(source.indexOf('function render('),source.indexOf('async function load()'))+source.slice(source.indexOf('let pointsQuiz=null')),context);
 vm.runInNewContext('render()',context);
 const card=$('assignments').children[0];assert.equal(card.children[1].textContent,'Edit Potential Points');assert.equal(card.children[0].className,'assignment-review');
 await card.children[1].onclick();assert.equal($('pointsDialog').open,true);assert.equal($('pointsQuiz').textContent,'Quiz <one>');
 const inputs=$('pointsQuestions').querySelectorAll('input');assert.equal(inputs.length,2);assert.equal(inputs[0].value,4);
 inputs[0].value='5';inputs[0].oninput();assert.equal($('pointsTotal').textContent,'5 regular points possible · 2 extra-credit points');
 await $('pointsForm').onsubmit({preventDefault(){}});assert.deepEqual(calls.at(-1),{action:'save-points',id:'custom-test',revision:3,points:[5,2],scoringModes:['total','total']});assert.match($('pointsStatus').textContent,/Teacher overrides and manual marks are unchanged/);
 const modes=$('pointsQuestions').querySelectorAll('select');assert.equal(modes.length,2);modes[0].value='response';modes[0].onchange();assert.equal($('pointsTotal').textContent,'15 regular points possible · 2 extra-credit points');
 fail=true;await $('pointsForm').onsubmit({preventDefault(){}});assert.equal(calls.at(-1).revision,4);assert.equal($('pointsStatus').textContent,'Close and reopen the editor');assert.equal(inputs[0].disabled,false);
 $('closePoints').onclick();assert.equal($('pointsDialog').open,false);
});


test('Potential-points answer column preserves repeated blanks, matching labels, sequence order, and model text',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/teacher/teacher.js'),'utf8');
 const element=tag=>({tag,children:[],textContent:'',append(...items){this.children.push(...items);}});
 const context={document:{createElement:element}};
 vm.runInNewContext(source.slice(source.indexOf('function pointsAnswerKey('),source.indexOf('async function openPoints(')),context);
 const blank=context.pointsAnswerKey({type:'gaps',answer:['א','א'],wordBank:false});
 assert.equal(blank.children[1].textContent,'2 blanks to complete · teacher graded');
 assert.deepEqual(blank.children[2].children.map(item=>item.textContent),['א','א']);
 const match=context.pointsAnswerKey({type:'match',items:['First','Unused','Third'],answer:['A','','C']});
 assert.equal(match.children[1].textContent,'2 correct matches');assert.deepEqual(match.children[2].children.map(item=>item.textContent),['First: A','Third: C']);
 const order=context.pointsAnswerKey({type:'order',answer:['ב','א']});assert.equal(order.children[1].textContent,'2 items in the correct order');assert.deepEqual(order.children[2].children.map(item=>item.textContent),['ב','א']);
 const written=context.pointsAnswerKey({type:'text',answer:'Explain <this>\nSecond line'});assert.equal(written.children[2].textContent,'Explain <this>\nSecond line');assert.equal(written.children[0].textContent,'Model answer');
});
