const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Dashboard opens the denominator editor, totals changes, saves its revision, and keeps errors visible',async()=>{
 const elements=new Map(),calls=[];
 function element(){return {children:[],value:'',textContent:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(k,v){this[k]=v;},addEventListener(){},reset(){},reportValidity(){return true;},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(selector){return this.children.flatMap(c=>[...(selector==='input' && c.type==='number'?[c]:[]),...c.querySelectorAll(selector)]);}};}
 const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 let fail=false;
 const quiz={id:'custom-test',title:'Quiz <one>',revision:3,questions:[{prompt:'Explain <this>',potentialPoints:4,extraCredit:false},{prompt:'Bonus',potentialPoints:2,extraCredit:true}]};
 const context={URL,location:{href:'https://www.penina-hebrew.org/Penina-Quizzes/teacher/'},document:{getElementById:$,createElement:element},fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return {ok:!fail,json:async()=>fail?{error:'Close and reopen the editor'}:{...quiz,revision:body.action==='save-points'?4:3}};}};
 const source=fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/teacher/teacher.js'),'utf8');
 vm.runInNewContext("const $=id=>document.getElementById(id);let assignments=[{quiz:'custom-test',title:'Quiz',className:'Class',courseId:'course',classId:'class',state:'PUBLISHED'}];"+source.slice(source.indexOf('function render()'),source.indexOf('async function load()'))+source.slice(source.indexOf('let pointsQuiz=null')),context);
 vm.runInNewContext('render()',context);
 const card=$('assignments').children[0];assert.equal(card.children[1].textContent,'Edit Potential Points');assert.equal(card.children[0].className,'assignment-review');
 await card.children[1].onclick();assert.equal($('pointsDialog').open,true);assert.equal($('pointsQuiz').textContent,'Quiz <one>');
 const inputs=$('pointsQuestions').querySelectorAll('input');assert.equal(inputs.length,2);assert.equal(inputs[0].value,4);
 inputs[0].value='5';inputs[0].oninput();assert.equal($('pointsTotal').textContent,'5 regular points possible · 2 extra-credit points');
 await $('pointsForm').onsubmit({preventDefault(){}});assert.deepEqual(calls.at(-1),{action:'save-points',id:'custom-test',revision:3,points:[5,2]});assert.match($('pointsStatus').textContent,/Earned points are unchanged/);
 fail=true;await $('pointsForm').onsubmit({preventDefault(){}});assert.equal(calls.at(-1).revision,4);assert.equal($('pointsStatus').textContent,'Close and reopen the editor');assert.equal(inputs[0].disabled,false);
 $('closePoints').onclick();assert.equal($('pointsDialog').open,false);
});
