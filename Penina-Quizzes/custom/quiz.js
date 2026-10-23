'use strict';
const previewKey=new URLSearchParams(location.search).get('preview');
const previewQuiz=previewKey?JSON.parse(sessionStorage.getItem(previewKey)||'null'):null;

const quizId=new URLSearchParams(location.search).get('quiz') || '';
const API = '/api/game-scores?game=assessment-custom&quiz='+encodeURIComponent(quizId);
const ACCOUNT_API='/api/game-scores?game=quiz-account&quiz='+encodeURIComponent(quizId);
document.querySelector('footer a').href='teacher.html?quiz='+encodeURIComponent(quizId);
const classId=new URLSearchParams(location.search).get('class') || '';
let DRAFT, isClassTeacher = false;
let forwardOnlyFrom=null,lockedThrough=-1,forwardOnly=false,onCheckpoint=false,moving=false;
let questions, saved = {}, submission, page = 0, expired = false, sending = false, clock;
const form = document.getElementById('quiz'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function store() { try { (previewQuiz?sessionStorage:localStorage).setItem(previewQuiz?previewKey+':progress':DRAFT, JSON.stringify(saved)); } catch (_) {} }
function snapshot() {
    saved.values = {};
    for(const control of form.querySelectorAll('#questions input, #questions textarea, #questions select'))
        saved.values[control.name]=control.type==='checkbox'?control.checked:control.type==='radio'?(form.elements.namedItem(control.name)?.value||''):control.value;
    if(questions)saved.answers=questions.map(answer);
    store();
}
function restoreAnswers(){
    for(const control of form.querySelectorAll('#questions input, #questions textarea, #questions select')){
        const value=saved.values?.[control.name];
        if(value!==undefined){if(control.type==='checkbox')control.checked=value===true;else if(control.type==='radio')control.checked=control.value===value;else control.value=value;}
    }
    // New drafts store answer values, so future display-order changes cannot move a selection.
    if(Array.isArray(saved.answers))questions.forEach((q,i)=>{
        const values=saved.answers[i];if(!Array.isArray(values))return;
        if(q.type==='multi')form.querySelectorAll(`[data-question="${i}"] input[type=checkbox]`).forEach(control=>control.checked=values.includes(control.value));
        else values.forEach((value,j)=>{const control=form.elements.namedItem(`q${i}-${j}`);if(control)control.value=value;});
    });
}
function answer(q,i) {
    if(q.type==='multi')return [...form.querySelectorAll(`[data-question="${i}"] input:checked`)].map(c=>c.value);
    const count=q.type==='gaps'?q.prompt.split('___').length-1:q.type==='match'?q.items.length:q.type==='order'?q.choices.length:1;
    return Array.from({length:count},(_,j)=>form.elements.namedItem(`q${i}-${j}`)?.value || '');
}
function shuffled(values) {
    const copy=[...values];
    for(let i=copy.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
    return copy;
}
function controls(q,i){return QuizInteractions.controls(q,i);}
async function request(record) {
    if(previewQuiz){if(record.action==='start')return {id:'preview',token:'preview',deadline:previewQuiz.durationMinutes===null?null:Date.now()+previewQuiz.durationMinutes*60000};if(record.action==='state')return {lockedThrough:saved.lockedThrough??-1,forwardOnly:saved.forwardOnly===true,lockedAnswers:saved.lockedAnswers||[]};if(record.action==='advance'){lockedThrough=record.through;forwardOnly=true;saved.lockedAnswers=record.answers;saved.lockedThrough=lockedThrough;saved.forwardOnly=forwardOnly;store();return {lockedThrough,forwardOnly,lockedAnswers:record.answers};}if(record.action==='submit')return {accepted:true,answers:record.answers,submittedAt:new Date().toISOString(),automatic:QuizScoring.feedback(previewQuiz.questions,record.answers)};}

    const response = await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...record,classId})});
    const result = await response.json(); if(response.status===401)document.getElementById('googleLogin').hidden=false; if (!response.ok) throw new Error(result.error || 'Your quiz could not be saved.'); return result;
}
function navigate(value) {
    onCheckpoint=!expired && forwardOnlyFrom!==null && !forwardOnly && value>=forwardOnlyFrom;
    page=expired?questions.length:forwardOnly?Math.min(questions.length,lockedThrough+1):Math.max(0,Math.min(questions.length,value));
    if(onCheckpoint)page=forwardOnlyFrom;
    saved.page=page;store();
    document.querySelectorAll('#questions > section').forEach((section,i)=>section.hidden=onCheckpoint || i!==page);
    document.getElementById('checkpointPage').hidden=!onCheckpoint;
    document.getElementById('review').hidden=onCheckpoint || page!==questions.length;
    document.getElementById('previous').disabled=page===0 || expired || forwardOnly || moving;
    document.getElementById('next').hidden=onCheckpoint || page===questions.length;
    document.getElementById('next').disabled=expired || moving;
    document.getElementById('next').textContent=forwardOnly?'Lock answer & next':'Next';
    document.getElementById('progress').textContent=onCheckpoint?'Review checkpoint':page===questions.length?(forwardOnly?'Submit quiz':'Review and submit'):`Question ${page+1} of ${questions.length}`;
    document.getElementById('reviewHeading').textContent=forwardOnly?'Submit your quiz':'Review your answers';
    document.getElementById('reviewDescription').textContent=forwardOnly?'Your answers are locked. Submit them now to finish the quiz.':'Click the button to submit or go back to review your answers.';
    QuizInteractions.refresh(form);
    document.getElementById('reviewedLabel').textContent=forwardOnly?'I am ready to submit my locked answers.':'I have reviewed my answers.';
}
function applyProgress(state) {
    lockedThrough=state.lockedThrough;forwardOnly=state.forwardOnly;
    for(let i=0;i<=lockedThrough;i++){
        const values=state.lockedAnswers[i];
        if(questions[i].type==='multi')for(const control of form.querySelectorAll(`[data-question="${i}"] input`))control.checked=values.includes(control.value);
        else values.forEach((v,j)=>{form.elements.namedItem(`q${i}-${j}`).value=v;});
        form.querySelectorAll(`[data-question="${i}"] input, [data-question="${i}"] textarea, [data-question="${i}"] select`).forEach(c=>c.disabled=true);
    }
    snapshot();
}
function incomplete(index){const values=answer(questions[index],index);if(questions[index].extraCredit)return questions[index].type==='order' && new Set(values.filter(Boolean)).size!==values.filter(Boolean).length;return !values.length || (questions[index].type==='match' && values.filter(Boolean).length<questions[index].responseCount) || (questions[index].type!=='match' && values.some(v=>!v.trim())) || (questions[index].type==='order' && new Set(values).size!==values.length);}
async function advance(through) {
    if(moving || expired)return;
    for(let i=lockedThrough+1;i<=through;i++)if(incomplete(i)){navigate(i);status.textContent='Complete this answer before locking it and continuing.';return;}
    moving=true;navigate(page);document.getElementById('confirmCheckpoint').disabled=true;document.getElementById('reviewEarlier').disabled=true;
    form.querySelectorAll('#questions input, #questions textarea, #questions select').forEach(c=>c.disabled=true);
    snapshot();status.textContent='Saving and locking your answers…';
    try {
        const state=await request({action:'advance',id:saved.id,token:saved.attempt.token,through,answers:questions.map(answer)});
        applyProgress(state);status.textContent='Earlier answers are locked. You can only move forward.';
    }catch(error){status.textContent=error.message+' Your answers remain here. Try again before continuing.';}
    finally {
        moving=false;
        form.querySelectorAll('#questions > section').forEach((section,i)=>section.querySelectorAll('input,textarea,select').forEach(c=>c.disabled=expired || i<=lockedThrough));
        document.getElementById('confirmCheckpoint').disabled=expired;document.getElementById('reviewEarlier').disabled=expired;
        navigate(forwardOnly?lockedThrough+1:page);tick();if(expired)submitQuiz();
    }
}
function showReceipt() {
    clearInterval(clock); form.hidden = true; status.textContent = '';
    document.getElementById('receipt').hidden = false;
    if(isClassTeacher) {
        document.getElementById('receiptMessage').textContent='Teacher practice complete. You can take the quiz again. These answers are kept separate from student submissions.';
        document.getElementById('repeatQuiz').hidden=false;
    }
    if(previewQuiz){document.getElementById('receiptMessage').textContent='Preview complete. No student submission was sent.';document.getElementById('newStudent').textContent='Restart preview';}
    document.getElementById('receiptId').textContent = `Receipt: ${submission.id}`;
    const automatic = new Map((submission.automatic || []).map(q=>[q.index,q]));
    document.getElementById('answerFeedback').innerHTML=questions.map((q,i)=>{
        const result=q.type==='text' || q.type==='gaps' && q.wordBank===false?null:automatic.get(i);
        return `<section class="${q.extraCredit?'extra-credit':''}">${q.extraCredit?'<p class="number">Extra credit</p>':''}<h3 dir="auto">${i+1}. ${esc(q.prompt)}</h3><p class="answer">Your answer: ${submission.answers[i].map((a,j)=>esc((q.type==='match'?q.items[j]+': ':'')+(a||'(Unanswered)'))).join('<br>')}</p>${result?`<p class="${result.correct?'correct':result.partial?'partial':'incorrect'}">${result.correct?'Correct':result.partial?'Partial credit':'Incorrect'}</p>`:'<p class="needs-correction">Needs correction</p>'}</section>`;
    }).join('');
}
function tick() {
    if(submission || !saved.attempt) return;
    if(saved.attempt.deadline===null){document.getElementById('timer').textContent='No time limit';return;}
    const seconds=Math.max(0,Math.ceil((saved.attempt.deadline-Date.now())/1000));
    document.getElementById('timer').textContent=`Time remaining: ${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    if(seconds===0 && !expired) {
        snapshot(); expired=true; saved.expiredAnswers=questions.map(answer); store();
        navigate(questions.length);
        form.querySelectorAll('#questions input, #questions textarea, #questions select').forEach(control=>control.disabled=true);
        document.getElementById('reviewed').disabled=true;
        status.textContent='Time has expired. Your answers are locked. Submitting your saved work…';
        submitQuiz();
    }
}
async function enterQuiz() {
    const state=await request({action:'state',id:saved.id,token:saved.attempt.token});
    applyProgress(state);
    form.elements.studentName.readOnly=true; form.elements.studentEmail.readOnly=true;
    document.getElementById('start').hidden=true;
    document.getElementById('exam').hidden=false;
    navigate(Number(saved.page)||0); tick(); clock=setInterval(tick,1000);
}
(async () => {
    try {
        if(!previewQuiz && !/^[a-f0-9]{32}$/.test(classId)) {
            document.getElementById('googleSignIn').hidden=true;
            throw new Error('Open the class-specific quiz link your teacher posted in Google Classroom.');
        }
        const response = previewQuiz?{ok:true,json:async()=>({...previewQuiz,name:'Student preview',email:'',className:'Preview — answers are not submitted',questions:previewQuiz.questions.map(q=>({...q,maxPoints:QuizScoring.maxPoints(q),responseCount:QuizScoring.responseCount(q)}))})}:await fetch(ACCOUNT_API+'&action=student&classId='+encodeURIComponent(classId));
        const identity=await response.json();
        if(!response.ok)throw new Error(identity.error || 'Sign in with Google to continue.');
        questions=identity.questions;
        document.querySelector('h1').textContent=identity.title;document.title=identity.title+' | PP Quiz';
        document.getElementById('quizSummary').textContent=questions.length+' questions · '+questions.filter(q=>!q.extraCredit).reduce((n,q)=>n+(q.maxPoints ?? q.points),0)+' regular points · '+questions.filter(q=>q.extraCredit).reduce((n,q)=>n+(q.maxPoints ?? q.points),0)+' extra-credit points';
        document.getElementById('durationDescription').textContent=identity.durationMinutes===null?'No time limit.':'Time limit: '+identity.durationMinutes+' minutes. The timer continues if you leave this page.';
        document.getElementById('timedNotice').hidden=identity.durationMinutes===null;
        forwardOnlyFrom=identity.forwardOnlyFrom ?? null;document.getElementById('checkpointText').textContent=identity.checkpointMessage || '';
        isClassTeacher=identity.isClassTeacher===true;
        if(isClassTeacher)document.getElementById('attemptRule').textContent='Teacher practice: you may take this quiz as many times as you want.';
        DRAFT='penina-custom:'+quizId+':'+identity.sub+':'+classId;
        document.getElementById('googleLogin').hidden=true;
        document.getElementById('studentIdentity').textContent=identity.name+' · '+identity.email+' · '+identity.className;
        form.elements.studentName.value=identity.name;form.elements.studentEmail.value=identity.email;
        try { saved = JSON.parse((previewQuiz?sessionStorage:localStorage).getItem(previewQuiz?previewKey+':progress':DRAFT)) || {}; } catch (_) {}
        document.getElementById('questions').innerHTML=questions.map((q,i)=>`<section class="card ${q.extraCredit?'extra-credit':''}" data-question="${i}" hidden><p class="number">Question ${i+1}${q.extraCredit?' · Extra credit (optional)':''} · ${q.maxPoints ?? q.points} point${(q.maxPoints ?? q.points)===1?'':'s'}${q.scoringMode==='response'?' · '+q.points+' per correct response':''}</p><h2 class="prompt" dir="${q.direction}">${q.type==='gaps'?'Fill in the blanks':esc(q.prompt)}</h2>${controls(q,i)}</section>`).join('');
        restoreAnswers();
        for(const select of form.querySelectorAll('.ordering select'))sizeOrderWord(select);
        form.hidden = false; status.textContent = 'Your work is saved on this browser as you go.';
        if (saved.submission) { submission = saved.submission; showReceipt(); }
        else if(saved.attempt) await enterQuiz();
    } catch (error) { status.textContent = error.message; }
})();
form.addEventListener('input',snapshot);
document.getElementById('start').addEventListener('click',async()=>{
    if(!previewQuiz && (!form.elements.studentName.reportValidity() || !form.elements.studentEmail.reportValidity())) return;
    const button=document.getElementById('start');button.disabled=true;
    saved.id ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,'0')).join('');snapshot();
    try {
        saved.attempt=await request({action:'start',id:saved.id,email:form.elements.studentEmail.value.trim()});
        saved.id=saved.attempt.id;store();await enterQuiz();
    } catch(error) {status.textContent=error.message;}
    finally {button.disabled=false;}
});
async function submitQuiz() {
    if(sending || submission || !saved.attempt || moving) return;
    if(!expired) {
        for(let i=0;i<questions.length;i++) if(incomplete(i)) {
            navigate(i);status.textContent=questions[i].type==='match'?'Make at least '+questions[i].responseCount+' matches before submitting. Leave distractor terms unmatched.':'Complete this question before submitting, and use each ordering item only once.';
            form.querySelector(`[data-question="${i}"] input, [data-question="${i}"] textarea, [data-question="${i}"] select`)?.focus(); return;
        }
        if(!document.getElementById('reviewed').checked) {document.getElementById('reviewed').reportValidity();return;}
    }
    const button = document.getElementById('submit'), message = document.getElementById('submissionStatus');
    sending=true;button.disabled = true; message.textContent = 'Saving your answers…';
    const record = {action:'submit',token:saved.attempt.token,id:saved.id,name:form.elements.studentName.value.trim(),email:form.elements.studentEmail.value.trim(),answers:expired?saved.expiredAnswers:questions.map(answer)};
    try {
        const result=await request(record);if(!result.accepted) throw new Error('Your quiz was not saved.');
        submission = {...record,answers:result.answers,submittedAt:result.submittedAt,automatic:result.automatic};
        delete submission.token; saved.submission = submission; store(); showReceipt();
    } catch(error) {message.textContent=error.message+' Your answers remain saved here. Try submitting again.';message.className='warning';}
    finally {sending=false;button.disabled = false;}
}
form.addEventListener('submit',event=>{event.preventDefault();submitQuiz();});
document.getElementById('previous').addEventListener('click',()=>navigate(page-1));
document.getElementById('next').addEventListener('click',()=>forwardOnly?advance(page):navigate(page+1));
document.getElementById('confirmCheckpoint').addEventListener('click',()=>advance(forwardOnlyFrom-1));
document.getElementById('reviewEarlier').addEventListener('click',()=>navigate(0));
document.getElementById('newStudent').addEventListener('click',async()=>{
    if(previewQuiz){sessionStorage.removeItem(previewKey+':progress');location.reload();return;}
    await fetch(ACCOUNT_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});location.reload();
});
document.getElementById('googleSignIn').addEventListener('click',async()=>{
    const button=document.getElementById('googleSignIn');button.disabled=true;
    try {
        const response=await fetch(ACCOUNT_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',role:'student',classId})});
        const result=await response.json();if(!response.ok)throw new Error(result.error);
        location.assign(result.url);
    }catch(error){status.textContent=error.message;button.disabled=false;}
});

document.getElementById('repeatQuiz').addEventListener('click',()=>{
    if(!isClassTeacher)return;
    localStorage.removeItem(DRAFT);location.reload();
});

function sizeOrderWord(select) {
    if(select.closest('.ordering'))select.parentElement.classList.toggle('long-word',select.value.replace(/[\u0591-\u05bd\u05bf-\u05c7]/g,'').length>12);
}
let draggedWord='';
form.addEventListener('dragstart',event=>{
    if(event.target.matches('.word')){draggedWord=event.target.textContent;event.dataTransfer.setData('text/plain',draggedWord);}
});
form.addEventListener('dragover',event=>{if(event.target.matches('.sentence select') && !expired)event.preventDefault();});
form.addEventListener('drop',event=>{
    if(!event.target.matches('.sentence select') || expired)return;
    event.preventDefault();
    if([...event.target.options].some(option=>option.value===draggedWord)){event.target.value=draggedWord;snapshot();}
    draggedWord='';
});
form.addEventListener('change',event=>{
    const section=event.target.closest('[data-question]');
    if(!section || event.target.tagName!=='SELECT')return;
    for(const other of section.querySelectorAll('.ordering select'))if(other!==event.target && event.target.value && other.value===event.target.value)other.value='';
    for(const select of section.querySelectorAll('select'))sizeOrderWord(select);
    snapshot();
});

QuizInteractions.bind(form,snapshot,i=>!expired && !moving && i>lockedThrough);
