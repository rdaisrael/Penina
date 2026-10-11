'use strict';
const API = '/api/game-scores?game=assessment';
const DRAFT = 'penina-gemara6-wl2-v1';
let questions, saved = {}, submission;
const form = document.getElementById('quiz'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function store() { try { localStorage.setItem(DRAFT, JSON.stringify(saved)); } catch (_) {} }
function answer(q, i) { return Array.from({length:q.fields?.length || 1}, (_, j) => form.elements.namedItem(`q${i}-${j}`)?.value || ''); }
function diagram(i) {
    const marks = i === 12 ? '<circle cx="750" cy="85" r="25"/><text x="750" y="93">A</text><circle cx="330" cy="277" r="25"/><text x="330" y="285">B</text>' : '<circle cx="842" cy="34" r="29"/><text x="842" y="42">A</text>';
    return `<div class="diagram"><img src="talmud-page.png" alt="Talmud page used for the extra-credit question. Use the marked areas to answer." width="999" height="531"><svg aria-hidden="true" viewBox="0 0 999 531">${marks}</svg></div>`;
}
function showReceipt() {
    form.hidden = true; status.textContent = '';
    document.getElementById('receipt').hidden = false;
    document.getElementById('receiptId').textContent = `Receipt: ${submission.id}`;
}
function currentRecord() { return {id:saved.id || 'Not submitted',name:form.elements.studentName.value.trim(),email:form.elements.studentEmail.value.trim(),answers:questions.map(answer),submittedAt:new Date().toISOString()}; }
function downloadAnswers() {
    const record = submission || currentRecord();
    const content = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Gemara 6 — Quiz WL #2 answers</title><style>body{font:18px/1.6 system-ui;max-width:850px;margin:40px auto;padding:20px}p{white-space:pre-wrap;unicode-bidi:plaintext}</style><h1>Gemara 6 — Quiz WL #2</h1><p>${esc(record.name)} · ${esc(record.email)}</p><p>Receipt: ${esc(record.id)}<br>Saved: ${esc(record.submittedAt)}</p>${questions.map((q,i)=>`<h2>${i+1}. ${esc(q.prompt)}</h2>${record.answers[i].map((a,j)=>`<p>${q.fields ? esc(q.fields[j])+': ' : ''}${esc(a||'(No extra-credit answer)')}</p>`).join('')}`).join('')}<p>${submission ? 'This submission was accepted by Penina. Your teacher reviews and grades the answers.' : 'This is an UNSUBMITTED answer copy. Attach this file in Classroom if you cannot submit in Penina.'}</p></html>`;
    const url = URL.createObjectURL(new Blob([content], {type:'text/html'})), a = document.createElement('a');
    a.href = url; a.download = 'Gemara-6-Quiz-WL-2-answers.html'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
(async () => {
    try {
        const response = await fetch('questions.json'); if (!response.ok) throw new Error('Quiz questions could not be loaded.'); questions = await response.json();
        try { saved = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch (_) {}
        document.getElementById('questions').innerHTML = questions.map((q,i)=>`<section class="card"><p class="number">Question ${i+1} · ${i<12?'1 point':'2 extra-credit points'}</p><h2 class="prompt" dir="auto">${esc(q.prompt)}</h2>${q.image ? diagram(i) : ''}${q.choices ? `<fieldset style="border:0;padding:0;margin:0"><legend class="muted">Choose one answer</legend>${q.choices.map(c=>`<label class="choice"><input type="radio" name="q${i}-0" value="${esc(c)}" required><span dir="auto">${esc(c)}</span></label>`).join('')}</fieldset>` : (q.fields || ['Your answer']).map((label,j)=>`<label>${esc(label)}<textarea name="q${i}-${j}" dir="auto" maxlength="2000" ${i<12?'required':''}></textarea></label>`).join('')}</section>`).join('');
        for (const [name,value] of Object.entries(saved.values || {})) { const control = form.elements.namedItem(name); if (control) control.value = value; }
        form.hidden = false; status.textContent = 'Your work is saved on this browser as you go.';
        if (saved.submission) { submission = saved.submission; showReceipt(); }
    } catch (error) { status.textContent = error.message + ' Reload the page to try again.'; }
})();
form.addEventListener('input',()=>{ saved.values = {}; for(const [name,value] of new FormData(form)) saved.values[name] = value; store(); });
form.addEventListener('submit',async event=>{
    event.preventDefault(); if (!form.reportValidity()) return;
    const button = document.getElementById('submit'), message = document.getElementById('submissionStatus');
    button.disabled = true; message.textContent = 'Saving your answers…';
    saved.id ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,'0')).join(''); store();
    const record = {action:'submit',id:saved.id,name:form.elements.studentName.value.trim(),email:form.elements.studentEmail.value.trim(),answers:questions.map(answer),submittedAt:new Date().toISOString()};
    try {
        const response = await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});
        const result = await response.json(); if (!response.ok || !result.accepted) throw new Error(result.error || 'Your quiz was not saved.');
        submission = record; saved.submission = submission; store(); showReceipt();
    } catch(error) { message.textContent = error.message + ' Your answers remain here; try submitting again.'; message.className = 'warning'; }
    finally { button.disabled = false; }
});
document.getElementById('download').addEventListener('click',downloadAnswers);

document.getElementById('backup').addEventListener('click', downloadAnswers);
document.getElementById('newStudent').addEventListener('click', () => { saved = {}; try { localStorage.removeItem(DRAFT); } catch (_) {} location.reload(); });
