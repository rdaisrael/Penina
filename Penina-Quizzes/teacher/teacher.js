'use strict';
const $=id=>document.getElementById(id),API='/api/game-scores?game=quiz-account';
let assignments=[],archivedAssignments=[],archivesLoaded=false;
async function request(action,body){const r=await fetch(API+(body?'':'&action='+action),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action})}:{});const data=await r.json();if(!r.ok){const e=Error(data.error||'Please try again.');e.status=r.status;throw e;}return data;}
function render(archived=false){const list=$(archived?'archivedAssignments':'assignments');list.replaceChildren();const selected=$('classFilter').value;const items=(archived?archivedAssignments:assignments).filter(a=>!selected||a.courseId===selected);for(const a of items){const link=document.createElement('a');link.className='assignment-review';const url=new URL(a.quiz.startsWith('custom-')?'../custom/teacher.html':'../'+a.quiz+'/teacher.html',location.href);if(a.quiz.startsWith('custom-'))url.searchParams.set('quiz',a.quiz);url.searchParams.set('mode',a.state==='DRAFT'?'assign':'review');url.searchParams.set('course',a.courseId);url.searchParams.set('class',a.classId);link.href=url.href;const title=document.createElement('strong');title.textContent=a.title;const detail=document.createElement('span');detail.textContent=a.className+(a.state==='DRAFT'?' · Classroom draft — not posted yet':a.state==='UNKNOWN'?' · Classroom status unavailable':'')+(a.state==='DRAFT'?' · Review & publish draft →':' · Review student work →');link.append(title,detail);const card=document.createElement('div');card.className='assignment';card.append(link);if(a.quiz.startsWith('custom-')){const edit=document.createElement('button');edit.type='button';edit.className='edit-points';edit.textContent='Edit Potential Points';edit.setAttribute('aria-label','Edit Potential Points for '+a.title);edit.onclick=()=>openPoints(a.quiz);card.append(edit);}const archive=document.createElement('button');archive.type='button';archive.className='archive-quiz';archive.textContent=archived?'Restore':'Archive';archive.setAttribute('aria-label',(archived?'Restore ':'Archive ')+a.title+' · '+a.className);archive.onclick=()=>setArchived(a,!archived,archive);card.append(archive);list.append(card);}if(!items.length){const p=document.createElement('p');p.textContent=archived?'No archived quizzes for this class.':'No active quizzes for this class. Archived quizzes are available below.';list.append(p);}}
async function load(){const button=$('refresh');button.disabled=true;$('status').textContent='Loading your assignments…';try{const data=await request('assignments');assignments=data.assignments;const selected=$('classFilter').value;$('classFilter').replaceChildren(new Option('All classes',''));const classes=new Map([...assignments,...(archivesLoaded?archivedAssignments:[])].map(a=>[a.courseId,a.className]));for(const [id,name] of [...classes].sort((a,b)=>a[1].localeCompare(b[1],undefined,{sensitivity:'base',numeric:true})))$('classFilter').add(new Option(name,id));if(classes.has(selected))$('classFilter').value=selected;render();$('status').textContent='';}catch(e){$('status').textContent=e.message;}finally{button.disabled=false;}}
$('login').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button[type=submit]');button.disabled=true;$('status').textContent='Checking your account…';try{const result=await request('login',{role:'teacher',portal:true,reconnect:false});location.assign(result.url);}catch(e){$('status').textContent=e.message;button.disabled=false;}};
$('reconnect').onclick=async()=>{const button=$('reconnect');button.disabled=true;try{const result=await request('login',{role:'teacher',portal:true,reconnect:true});location.assign(result.url);}catch(e){$('status').textContent=e.message;button.disabled=false;}};
$('logout').onclick=async()=>{try{await request('logout',{});location.replace('./');}catch(e){$('status').textContent=e.message;}};
$('refresh').onclick=async()=>{await load();archivesLoaded=false;if($('archivedQuizzes').open)await loadArchives();};$('classFilter').onchange=()=>{render();if(archivesLoaded)render(true);};
async function loadArchives(){
    $('archiveStatus').textContent='Loading archived quizzes…';
    try{const data=await request('assignments&archived=true');archivedAssignments=data.assignments;archivesLoaded=true;const known=new Set([...$('classFilter').options].map(option=>option.value));for(const a of archivedAssignments){if(!known.has(a.courseId)){$('classFilter').add(new Option(a.className,a.courseId));known.add(a.courseId);}}render(true);$('archiveStatus').textContent='';}
    catch(error){$('archiveStatus').textContent=error.message;}
}
$('archivedQuizzes').addEventListener('toggle',()=>{if($('archivedQuizzes').open&&!archivesLoaded)loadArchives();});
async function setArchived(assignment,archived,button){
    button.disabled=true;
    try{
        await request('archive-assignment',{classId:assignment.classId,archived});
        assignments=assignments.filter(a=>a.classId!==assignment.classId);
        archivedAssignments=archivedAssignments.filter(a=>a.classId!==assignment.classId);
        (archived?archivedAssignments:assignments).push(assignment);
        render();if(archivesLoaded)render(true);
        $('status').textContent=archived?'Quiz archived. Find it under Show Archived Quizzes.':'Quiz restored to active quizzes.';
    }catch(error){$('status').textContent=error.message;button.disabled=false;}
}

(async()=>{try{const user=await request('teacher');$('logout').hidden=false;$('reconnect').hidden=false;$('identity').textContent='USER '+user.userId+' · '+user.email;document.querySelectorAll('[data-app-access]').forEach(el=>{el.hidden=!(user.apps || []).includes(el.dataset.appAccess);});$('status').textContent='';if((user.apps || []).includes('quizzes') && new URLSearchParams(location.search).get('view')==='correct'){$('correct').hidden=false;await load();}else $('home').hidden=false;}catch(e){if(e.status===401||e.status===403){$('signin').hidden=false;$('status').textContent='';}else $('status').textContent=e.message;}})();

let pointsQuiz=null,pointsBusy=false;
async function pointsRequest(action,body){const response=await fetch('/api/game-scores?game=quiz-builder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body})});const data=await response.json();if(!response.ok)throw Error(data.error || 'Potential points could not be saved.');return data;}
function pointsTotal(){if(!pointsQuiz)return;let regular=0,extra=0;[...$('pointsQuestions').querySelectorAll('input')].forEach((input,i)=>{const value=Number(input.value)||0;if(pointsQuiz.questions[i].extraCredit)extra+=value;else regular+=value;});$('pointsTotal').textContent=regular+' regular points possible · '+extra+' extra-credit points';}
function pointsAnswerKey(q){
    const panel=document.createElement('div');panel.className='points-answer-key';
    const heading=document.createElement('h3');heading.textContent=q.type==='text'?'Model answer':'Correct answers';panel.append(heading);
    const summary=document.createElement('p');summary.className='points-answer-count';panel.append(summary);
    if(q.type==='text'){
        summary.textContent='Written response · teacher graded';
        const answer=document.createElement('p');answer.className='points-answer-text';answer.dir='auto';answer.textContent=q.answer || 'No model answer provided.';panel.append(answer);return panel;
    }
    const answers=Array.isArray(q.answer)?q.answer:[];
    const entries=answers.map((answer,index)=>({answer,index})).filter(entry=>entry.answer!=='');
    const count=entries.length;
    summary.textContent=q.type==='order'?count+' items in the correct order':q.type==='gaps'?count+' blank'+(count===1?'':'s')+' to complete':q.type==='match'?count+' correct match'+(count===1?'':'es'):count+' correct answer'+(count===1?'':'s');
    if(q.type==='gaps' && q.wordBank===false)summary.textContent+=' · teacher graded';
    if(!count){const empty=document.createElement('p');empty.textContent='No answer key provided.';panel.append(empty);return panel;}
    const list=document.createElement('ol');
    entries.forEach(({answer,index})=>{const item=document.createElement('li');item.dir='auto';item.textContent=q.type==='match'?(q.items?.[index] || 'Item '+(index+1))+': '+answer:answer;list.append(item);});
    panel.append(list);return panel;
}
async function openPoints(id){pointsQuiz=null;$('pointsForm').reset();$('pointsQuestions').replaceChildren();$('pointsTotal').textContent='';$('pointsQuiz').textContent='';$('pointsStatus').textContent='Loading potential points…';$('savePoints').disabled=true;$('closePoints').textContent='Cancel';$('pointsDialog').showModal();pointsBusy=true;
try{const quiz=await pointsRequest('load-points',{id});pointsQuiz=quiz;$('pointsQuiz').textContent=quiz.title;quiz.questions.forEach((q,i)=>{const row=document.createElement('div');row.className='points-question';const label=document.createElement('label');label.textContent='Question '+(i+1)+(q.extraCredit?' · Extra credit':'')+': '+q.prompt;label.dir='auto';const input=document.createElement('input');input.type='number';input.min='0.5';input.max='5000';input.step='0.5';input.required=true;input.value=q.potentialPoints;input.setAttribute('aria-label','Potential points for question '+(i+1));input.oninput=pointsTotal;input.onkeydown=event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown')event.preventDefault();};input.addEventListener('wheel',event=>event.preventDefault(),{passive:false});label.append(input);row.append(label,pointsAnswerKey(q));$('pointsQuestions').append(row);});pointsTotal();$('pointsStatus').textContent='';$('savePoints').disabled=false;}catch(error){$('pointsStatus').textContent=error.message;}finally{pointsBusy=false;}}
$('closePoints').onclick=()=>{if(!pointsBusy)$('pointsDialog').close();};
$('pointsDialog').addEventListener('cancel',event=>{if(pointsBusy)event.preventDefault();});
$('pointsForm').onsubmit=async event=>{event.preventDefault();if(!pointsQuiz || pointsBusy || !$('pointsForm').reportValidity())return;const inputs=[...$('pointsQuestions').querySelectorAll('input')];pointsBusy=true;$('savePoints').disabled=true;inputs.forEach(input=>input.disabled=true);$('pointsStatus').textContent='Saving potential points…';try{pointsQuiz=await pointsRequest('save-points',{id:pointsQuiz.id,revision:pointsQuiz.revision,points:inputs.map(input=>Number(input.value))});$('pointsStatus').textContent='Saved. Earned points are unchanged. Review student work to send revised grades and emails. If the regular total changed, match that total in Classroom first.';$('closePoints').textContent='Done';}catch(error){$('pointsStatus').textContent=error.message;}finally{pointsBusy=false;$('savePoints').disabled=false;inputs.forEach(input=>input.disabled=false);}};
