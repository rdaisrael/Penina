'use strict';
const idleSessionScript=document.createElement('script');idleSessionScript.src='/session-idle.js';document.head.append(idleSessionScript);
const returnHomeScript=document.createElement('script');returnHomeScript.src='/return-to-penina.js';document.head.append(returnHomeScript);
const API = '/api/game-scores?game=assessment-retake';
const ACCOUNT_API='/api/game-scores?game=quiz-account&quiz=gemara-6-intro-retake';
const classId=new URLSearchParams(location.search).get('class') || '';
let DRAFT, isClassTeacher = false;
let questions, saved = {}, submission, page = 0, expired = false, sending = false, clock;
const form = document.getElementById('quiz'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function store() { try { localStorage.setItem(DRAFT, JSON.stringify(saved)); } catch (_) {} }
function snapshot() {
    saved.values = {};
    for(const control of form.querySelectorAll('#questions input, #questions textarea, #questions select'))
        saved.values[control.name]=control.type==='checkbox'?control.checked:control.value;
    store();
}
function answer(q,i) {
    if(q.type==='multi')return [...form.querySelectorAll(`[data-question="${i}"] input:checked`)].map(c=>c.value);
    const count=q.type==='gaps'?2:q.type==='order'?q.choices.length:1;
    return Array.from({length:count},(_,j)=>form.elements.namedItem(`q${i}-${j}`)?.value || '');
}
function shuffled(values) {
    const copy=[...values];
    for(let i=copy.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
    return copy;
}
function controls(q,i) {
    const choices=q.choices?shuffled(q.choices):[];
    const select=(j,label)=>`<select name="q${i}-${j}" aria-label="${esc(label)}" required><option value="">Choose a word</option>${choices.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>`;
    if(q.type==='multi')return `<fieldset><legend>Check all that apply</legend>${choices.map((c,j)=>`<label class="choice"><input type="checkbox" name="q${i}-choice-${q.choices.indexOf(c)}" value="${esc(c)}"><span dir="auto">${esc(c)}</span></label>`).join('')}</fieldset>`;
    if(q.type==='gaps')return `<p class="muted">Drag a word into a blank, or choose it from the blank’s menu.</p><div class="word-bank">${choices.map(c=>`<span draggable="true" class="word" dir="rtl">${esc(c)}</span>`).join('')}</div><p class="sentence">${esc(q.parts[0])}${select(0,'First blank')}${esc(q.parts[1])}${select(1,'Second blank')}${esc(q.parts[2])}</p><p>${esc(q.note)}</p>`;
    if(q.type==='order')return `<p class="muted">Choose each word in order. Position 1 is on the right. Each word can be used once.</p><div class="ordering" dir="rtl">${choices.map((_,j)=>`<label><span>(${j+1})</span>${select(j,'Position '+(j+1)+' from the right')}</label>`).join('')}</div>`;
    return `<label>Your answer<textarea name="q${i}-0" dir="auto" spellcheck="true" maxlength="2000" required></textarea></label>`;
}
async function request(record) {
    const response = await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...record,classId})});
    const result = await response.json(); if(response.status===401)document.getElementById('googleLogin').hidden=false; if (!response.ok) throw new Error(result.error || 'Your quiz could not be saved.'); return result;
}
function navigate(value) {
    page = Math.max(0,Math.min(questions.length,value)); saved.page=page; store();
    document.querySelectorAll('#questions > section').forEach((section,i)=>section.hidden=i!==page);
    document.getElementById('review').hidden=page!==questions.length;
    document.getElementById('previous').disabled=page===0 || expired;
    document.getElementById('next').hidden=page===questions.length;
    document.getElementById('next').disabled=expired;
    document.getElementById('progress').textContent=page===questions.length?'Review and submit':`Question ${page+1} of ${questions.length}`;
}
function showReceipt() {
    clearInterval(clock); form.hidden = true; status.textContent = '';
    document.getElementById('receipt').hidden = false;
    if(!isClassTeacher)document.getElementById('receiptMessage').textContent=submission.classroom?.turnedIn?'Your answers are saved in Penina and your work is turned in to Classroom. Your teacher will review and return your grade.':(submission.classroom?.message || 'Your answers are saved in Penina. Open Classroom and mark this assignment as done.');
    if(isClassTeacher) {
        document.getElementById('receiptMessage').textContent='Teacher practice complete. You can take the quiz again. These answers are kept separate from student submissions.';
        document.getElementById('repeatQuiz').hidden=false;
    }
    document.getElementById('receiptId').textContent = `Receipt: ${submission.id}`;
    const automatic = new Map((submission.automatic || []).map(q=>[q.index,q]));
    document.getElementById('answerFeedback').innerHTML=questions.map((q,i)=>{
        const result=automatic.get(i);
        return `<section><h3 dir="auto">${i+1}. ${esc(q.prompt)}</h3><p class="answer">Your answer: ${submission.answers[i].map(a=>esc(a||'(Unanswered)')).join('<br>')}</p>${result?`<p class="${result.correct?'correct':'warning'}">${result.correct?'Correct':'Incorrect'}</p>`:'<p>Awaiting teacher correction.</p>'}</section>`;
    }).join('');
}
function tick() {
    if(submission || !saved.attempt) return;
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
function enterQuiz() {
    form.elements.studentName.readOnly=true; form.elements.studentEmail.readOnly=true;
    document.getElementById('start').hidden=true;
    document.getElementById('exam').hidden=false;
    navigate(Number(saved.page)||0); tick(); clock=setInterval(tick,1000);
}
(async () => {
    try {
        if(!/^[a-f0-9]{32}$/.test(classId)) {
            document.getElementById('googleSignIn').hidden=true;
            throw new Error('Open the class-specific quiz link your teacher posted in Google Classroom.');
        }
        const response = await fetch(ACCOUNT_API+'&action=student&classId='+encodeURIComponent(classId));
        const identity=await response.json();
        if(!response.ok)throw new Error(identity.error || 'Sign in with Google to continue.');
        questions=identity.questions;
        isClassTeacher=identity.isClassTeacher===true;
        if(isClassTeacher)document.getElementById('attemptRule').textContent='Teacher practice: you may take this quiz as many times as you want.';
        DRAFT='penina-gemara6-intro-retake-google:'+identity.sub+':'+classId;
        document.getElementById('googleLogin').hidden=true;
        document.getElementById('studentIdentity').textContent=identity.name+' · '+identity.email+' · '+identity.className;
        form.elements.studentName.value=identity.name;form.elements.studentEmail.value=identity.email;
        try { saved = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch (_) {}
        document.getElementById('questions').innerHTML=questions.map((q,i)=>`<section class="card" data-question="${i}" hidden><p class="number">Question ${i+1} · ${q.points} point${q.points===1?'':'s'}</p><h2 class="prompt" dir="auto">${esc(q.prompt)}</h2>${controls(q,i)}</section>`).join('');
        for(const control of form.querySelectorAll('#questions input, #questions textarea, #questions select')) {
            const value=saved.values?.[control.name];
            if(value!==undefined) {if(control.type==='checkbox')control.checked=value===true;else control.value=value;}
        }
        for(const select of form.querySelectorAll('.ordering select'))sizeOrderWord(select);
        form.hidden = false; status.textContent = 'Your work is saved on this browser as you go.';
        if (saved.submission) { submission = saved.submission; showReceipt(); }
        else if(saved.attempt) enterQuiz();
    } catch (error) { status.textContent = error.message; }
})();
form.addEventListener('input',snapshot);
document.getElementById('start').addEventListener('click',async()=>{
    if(!form.elements.studentName.reportValidity() || !form.elements.studentEmail.reportValidity()) return;
    const button=document.getElementById('start');button.disabled=true;
    saved.id ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,'0')).join('');snapshot();
    try {
        saved.attempt=await request({action:'start',id:saved.id,email:form.elements.studentEmail.value.trim()});
        saved.id=saved.attempt.id;store();enterQuiz();
    } catch(error) {status.textContent=error.message;}
    finally {button.disabled=false;}
});
async function submitQuiz() {
    if(sending || submission || !saved.attempt) return;
    if(!expired) {
        for(let i=0;i<questions.length;i++) if(!answer(questions[i],i).length || answer(questions[i],i).some(v=>!v.trim()) ||
            (['gaps','order'].includes(questions[i].type) && new Set(answer(questions[i],i)).size!==answer(questions[i],i).length)) {
            navigate(i);status.textContent='Please complete this question before submitting. Use each word only once.';
            form.elements.namedItem(`q${i}-0`)[0]?.focus?.(); return;
        }
        if(!document.getElementById('reviewed').checked) {document.getElementById('reviewed').reportValidity();return;}
    }
    const button = document.getElementById('submit'), message = document.getElementById('submissionStatus');
    sending=true;button.disabled = true; message.textContent = 'Saving your answers…';
    const record = {action:'submit',token:saved.attempt.token,id:saved.id,name:form.elements.studentName.value.trim(),email:form.elements.studentEmail.value.trim(),answers:expired?saved.expiredAnswers:questions.map(answer)};
    try {
        const result=await request(record);if(!result.accepted) throw new Error('Your quiz was not saved.');
        submission = {...record,answers:result.answers,submittedAt:result.submittedAt,automatic:result.automatic,classroom:result.classroom};
        delete submission.token; saved.submission = submission; store(); showReceipt();
    } catch(error) {message.textContent=error.message+' Your answers remain saved here. Try submitting again.';message.className='warning';}
    finally {sending=false;button.disabled = false;}
}
form.addEventListener('submit',event=>{event.preventDefault();submitQuiz();});
document.getElementById('previous').addEventListener('click',()=>navigate(page-1));
document.getElementById('next').addEventListener('click',()=>navigate(page+1));
document.getElementById('newStudent').addEventListener('click',async()=>{
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
    for(const other of section.querySelectorAll('select'))if(other!==event.target && event.target.value && other.value===event.target.value)other.value='';
    for(const select of section.querySelectorAll('select'))sizeOrderWord(select);
    snapshot();
});
