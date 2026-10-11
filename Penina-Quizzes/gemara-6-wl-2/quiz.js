'use strict';
const API = '/api/game-scores?game=assessment';
const DRAFT = 'penina-gemara6-wl2-v1';
let questions, saved = {}, submission, page = 0, expired = false, sending = false, clock;
const form = document.getElementById('quiz'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function store() { try { localStorage.setItem(DRAFT, JSON.stringify(saved)); } catch (_) {} }
function snapshot() { saved.values = {}; for(const [name,value] of new FormData(form)) saved.values[name] = value; store(); }
function answer(q, i) { return Array.from({length:q.fields?.length || 1}, (_, j) => form.elements.namedItem(`q${i}-${j}`)?.value || ''); }
function diagram(i) {
    const marks = i === 12 ? '<circle cx="750" cy="85" r="25"/><text x="750" y="93">A</text><circle cx="330" cy="277" r="25"/><text x="330" y="285">B</text>' : '<circle cx="842" cy="34" r="29"/><text x="842" y="42">A</text>';
    return `<div class="diagram"><img src="talmud-page.png" alt="Talmud page used for the extra-credit question. Use the marked areas to answer." width="999" height="531"><svg aria-hidden="true" viewBox="0 0 999 531">${marks}</svg></div>`;
}
async function request(record) {
    const response = await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Your quiz could not be saved.'); return result;
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
    document.getElementById('receiptId').textContent = `Receipt: ${submission.id}`;
    const automatic = new Map((submission.automatic || []).map(q=>[q.index,q]));
    document.getElementById('answerFeedback').innerHTML=questions.map((q,i)=>{
        const result=automatic.get(i);
        return `<section><h3 dir="auto">${i+1}. ${esc(q.prompt)}</h3><p class="answer">Your answer: ${submission.answers[i].map(a=>esc(a||'(Unanswered)')).join('<br>')}</p>${result?`<p class="${result.score?'correct':'warning'}">${result.score?'Correct':'Incorrect'}</p><p class="answer">Correct answer: ${esc(result.correctAnswer)}</p>`:'<p>Awaiting teacher correction.</p>'}</section>`;
    }).join('');
}
function tick() {
    if(submission || !saved.attempt) return;
    const seconds=Math.max(0,Math.ceil((saved.attempt.deadline-Date.now())/1000));
    document.getElementById('timer').textContent=`Time remaining: ${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    if(seconds===0 && !expired) {
        snapshot(); expired=true; saved.expiredAnswers=questions.map(answer); store();
        navigate(questions.length);
        form.querySelectorAll('#questions input, #questions textarea').forEach(control=>control.disabled=true);
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
        const response = await fetch('questions.json'); if (!response.ok) throw new Error('Quiz questions could not be loaded.'); questions = await response.json();
        try { saved = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch (_) {}
        document.getElementById('questions').innerHTML = questions.map((q,i)=>`<section class="card" hidden><p class="number">Question ${i+1} · ${i<12?'1 point':'2 extra-credit points'}</p><h2 class="prompt" dir="auto">${esc(q.prompt)}</h2>${q.image ? diagram(i) : ''}${q.choices ? `<fieldset style="border:0;padding:0;margin:0"><legend class="muted">Choose one answer</legend>${q.choices.map(c=>`<label class="choice"><input type="radio" name="q${i}-0" value="${esc(c)}" required><span dir="auto">${esc(c)}</span></label>`).join('')}</fieldset>` : (q.fields || ['Your answer']).map((label,j)=>`<label>${esc(label)}<textarea name="q${i}-${j}" dir="auto" spellcheck="true" maxlength="2000" ${i<12?'required':''}></textarea></label>`).join('')}</section>`).join('');
        for (const [name,value] of Object.entries(saved.values || {})) { const control = form.elements.namedItem(name); if (control) control.value = value; }
        form.hidden = false; status.textContent = 'Your work is saved on this browser as you go.';
        if (saved.submission) { submission = saved.submission; showReceipt(); }
        else if(saved.attempt) enterQuiz();
    } catch (error) { status.textContent = error.message + ' Reload the page to try again.'; }
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
        for(let i=0;i<12;i++) if(!answer(questions[i],i)[0].trim()) {
            navigate(i);status.textContent='Please answer this question before submitting.';
            form.elements.namedItem(`q${i}-0`)[0]?.focus?.(); return;
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
document.getElementById('next').addEventListener('click',()=>navigate(page+1));
document.getElementById('newStudent').addEventListener('click', () => { saved = {}; try { localStorage.removeItem(DRAFT); } catch (_) {} location.reload(); });
