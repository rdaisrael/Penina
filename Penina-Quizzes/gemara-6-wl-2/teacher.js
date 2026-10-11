'use strict';
let questions, records = [];
const form = document.getElementById('login'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const quizURL = new URL('./', location.href).href;
document.getElementById('studentLink').value = quizURL;
document.getElementById('classroom').href = 'https://classroom.google.com/share?url=' + encodeURIComponent(quizURL);
form.addEventListener('submit',async event=>{
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    status.textContent = 'Loading answers…'; document.getElementById('reports').replaceChildren(); document.getElementById('export').hidden = true; records = [];
    try {
        const qResponse = await fetch('questions.json'); if (!qResponse.ok) throw new Error('Questions could not be loaded.'); questions = await qResponse.json();
        const response = await fetch('/api/game-scores?game=assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'report',password:form.elements.password.value})});
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Answers could not be loaded.');
        records = result.submissions;
        status.textContent = `${records.length} submission${records.length===1?'':'s'}. All answers await teacher grading.`;
        document.getElementById('export').hidden = !records.length;
        document.getElementById('reports').innerHTML = records.map(r=>`<details class="card"><summary>${esc(r.name)} · ${esc(r.email)} · ${esc(new Date(r.submittedAt).toLocaleString())}</summary><p class="muted">Receipt: ${esc(r.id)}</p>${questions.map((q,i)=>`<h2 class="prompt">${i+1}. ${esc(q.prompt)}</h2>${r.answers[i].map((a,j)=>`<p class="answer">${q.fields?esc(q.fields[j])+': ':''}${esc(a||'(No answer)')}</p>`).join('')}`).join('')}</details>`).join('');
    } catch(error) { status.textContent = error.message; }
    finally { button.disabled = false; }
});
document.getElementById('export').addEventListener('click',()=>{
    const columns = questions.flatMap((q,i)=>(q.fields||['Answer']).map(f=>`${i+1}. ${q.prompt} — ${f}`));
    // Prevent answers or names being interpreted as spreadsheet formulas.
    const csvCell = v => { let s = String(v); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"'+s.replace(/"/g,'""')+'"'; };
    const rows = [['Name','School email','Submitted at','Receipt',...columns],...records.map(r=>[r.name,r.email,r.submittedAt,r.id,...r.answers.flat()])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'Gemara-6-Quiz-WL-2-submissions.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
