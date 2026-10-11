'use strict';
let questions, records = [];
const form = document.getElementById('login'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const quizURL = new URL('./', location.href).href;
document.getElementById('studentLink').value = quizURL;
document.getElementById('classroom').href = 'https://classroom.google.com/share?url=' + encodeURIComponent(quizURL);
function scoreText(g) {
    return g.pending ? `Multiple choice: ${g.automaticScore}/10 · ${g.pending} question${g.pending===1?'':'s'} awaiting correction` : `Final: ${g.total}/12 (includes extra credit) · Multiple choice: ${g.automaticScore}/10`;
}
function render() {
    document.getElementById('reports').innerHTML = records.map(r=>{
        const g=r.grading;
        return `<details class="card"><summary>${esc(r.name)} · ${esc(r.email)}<br><span id="score-${r.id}">${esc(scoreText(g))}</span></summary><p class="muted">Submitted: ${esc(new Date(r.submittedAt).toLocaleString())} · Receipt: ${esc(r.id)}</p><form class="correction" data-id="${r.id}">${questions.map((q,i)=>{
            const auto=g.automatic.find(item=>item.index===i),manual=g.manual.find(item=>item.index===i);
            return `<h2 class="prompt">${i+1}. ${esc(q.prompt)}</h2>${r.answers[i].map((a,j)=>`<p class="answer">${q.fields?esc(q.fields[j])+': ':''}${esc(a||'(No answer)')}</p>`).join('')}${auto ? `<p class="muted">Automatically graded: ${auto.score}/1 · Correct answer: <bdi>${esc(auto.correctAnswer)}</bdi></p>` : `<label>Points for question ${i+1} (0–${manual.max})<input name="manual${i}" type="number" min="0" max="${manual.max}" step="0.5" value="${manual.score??''}" placeholder="Awaiting correction"></label>`}`;
        }).join('')}<label>Teacher feedback<textarea name="feedback" maxlength="2000">${esc(g.feedback)}</textarea></label><p class="muted">Leave a points field blank to keep that question awaiting correction. Final scores use 12 regular points, plus up to 4 extra-credit points.</p><button type="submit">Save corrections</button><p class="saveStatus" role="status" aria-live="polite"></p></form></details>`;
    }).join('');
}
form.addEventListener('submit',async event=>{
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    status.textContent = 'Loading answers…'; document.getElementById('reports').replaceChildren(); document.getElementById('export').hidden = true; records = [];
    try {
        const qResponse = await fetch('questions.json'); if (!qResponse.ok) throw new Error('Questions could not be loaded.'); questions = await qResponse.json();
        const response = await fetch('/api/game-scores?game=assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'report',password:form.elements.password.value})});
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Answers could not be loaded.');
        records = result.submissions;
        status.textContent = `${records.length} submission${records.length===1?'':'s'}. Multiple-choice answers are graded automatically. Open a submission to correct written answers and extra credit.`;
        document.getElementById('export').hidden = !records.length; render();
    } catch(error) { status.textContent = error.message; }
    finally { button.disabled = false; }
});
document.getElementById('reports').addEventListener('submit',async event=>{
    event.preventDefault(); const correction=event.target;
    if(!correction.matches('.correction') || !correction.reportValidity())return;
    const r=records.find(item=>item.id===correction.dataset.id),message=correction.querySelector('.saveStatus'),button=correction.querySelector('button');
    button.disabled=true;message.textContent='Saving corrections…';
    const scores=r.grading.manual.map(q=>{const value=correction.elements.namedItem('manual'+q.index).value;return value===''?null:Number(value);});
    try {
        const response=await fetch('/api/game-scores?game=assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'correct',id:r.id,password:form.elements.password.value,scores,feedback:correction.elements.feedback.value})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Corrections were not saved.');
        r.grading=result.grading;document.getElementById('score-'+r.id).textContent=scoreText(r.grading);message.textContent='Corrections saved. '+scoreText(r.grading);
    }catch(error){message.textContent=error.message+' Your unsaved corrections remain in the fields.';}
    finally{button.disabled=false;}
});
document.getElementById('export').addEventListener('click',()=>{
    const columns = questions.flatMap((q,i)=>(q.fields||['Answer']).map(f=>`${i+1}. ${q.prompt} — ${f}`));
    // Prevent answers or names being interpreted as spreadsheet formulas.
    const csvCell = v => { let s = String(v); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"'+s.replace(/"/g,'""')+'"'; };
    const rows = [['Name','School email','Submitted at','Receipt','Multiple choice (out of 10)','Q3 points','Q6 points','Q13 extra credit','Q14 extra credit','Final score (out of 12, including extra credit)','Questions awaiting correction','Teacher feedback',...columns],...records.map(r=>[r.name,r.email,r.submittedAt,r.id,r.grading.automaticScore,...r.grading.manual.map(q=>q.score??''),r.grading.total??'',r.grading.pending,r.grading.feedback,...r.answers.flat()])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'Gemara-6-Quiz-WL-2-submissions.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
