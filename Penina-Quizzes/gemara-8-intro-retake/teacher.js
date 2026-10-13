'use strict';
let questions, records = [];
const form = document.getElementById('login'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const ACCOUNT_API='/api/game-scores?game=quiz-account&quiz=gemara-8-intro-retake';
const connectionStatus=document.getElementById('connectionStatus');
async function accountRequest(action,body) {
    const response=await fetch(ACCOUNT_API+(body?'':'&action='+action),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action})}:{});
    const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
(async()=>{
    try {
        const config=await accountRequest('config');
        if(!config.configured){connectionStatus.textContent='Google Classroom connection is awaiting one-time setup by the site owner.';document.querySelector('#connectGoogle button').disabled=true;return;}
        const result=await accountRequest('courses');
        connectionStatus.textContent='Connected as '+result.email;
        document.getElementById('chooseClass').hidden=false;
        document.getElementById('classChoice').innerHTML='<option value="">Choose a class</option>'+result.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.section?' — '+esc(c.section):''}</option>`).join('');
        if(!result.courses.length)connectionStatus.textContent+=' · No active classes taught by this account were found.';
    }catch(error){connectionStatus.textContent=error.message;}
})();
document.getElementById('connectGoogle').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    try{const result=await accountRequest('login',{role:'teacher',password:event.target.elements.password.value});location.assign(result.url);}
    catch(error){connectionStatus.textContent=error.message;button.disabled=false;}
});
document.getElementById('chooseClass').addEventListener('submit',async event=>{
    event.preventDefault();document.getElementById('classLink').hidden=true;const button=event.target.querySelector('button');button.disabled=true;
    try{
        const result=await accountRequest('assign',{courseId:document.getElementById('classChoice').value});
        document.getElementById('studentLink').value=result.url;document.getElementById('classroom').href=result.classroomURL;
        document.getElementById('classLink').hidden=false;connectionStatus.textContent=(result.state==='DRAFT'?'Draft created. Open Classroom to review and assign it to ':'Assignment ready for ')+result.className+'. Use this assignment for grade transfer.';
    }catch(error){connectionStatus.textContent=error.message;}finally{button.disabled=false;}
});
function scoreText(g) {
    return g.pending ? `Automatic: ${g.automaticScore}/${g.automaticMax} · ${g.pending} question${g.pending===1?'':'s'} awaiting correction` : `Final: ${g.total}/${g.baseMax} · Automatic: ${g.automaticScore}/${g.automaticMax}`;
}
function render() {
    document.getElementById('reports').innerHTML = records.map(r=>{
        const g=r.grading;
        return `<details class="card"><summary>${esc(r.name)} · ${esc(r.email)}<br><span id="score-${r.id}">${esc(scoreText(g))}</span></summary><p class="muted">Class: ${esc(r.className || 'Earlier submission')} · Submitted: ${esc(new Date(r.submittedAt).toLocaleString())} · Receipt: ${esc(r.id)}</p><form class="correction" data-id="${r.id}">${questions.map((q,i)=>{
            const auto=g.automatic.find(item=>item.index===i),manual=g.manual.find(item=>item.index===i);
            return `<h2 class="prompt">${i+1}. ${esc(q.prompt)}</h2>${r.answers[i].map((a,j)=>`<p class="answer">${q.fields?esc(q.fields[j])+': ':''}${esc(a||'(No answer)')}</p>`).join('')}${auto ? `<p class="muted">Automatically graded: ${auto.score}/${auto.max} · Correct answer: <bdi>${esc(auto.correctAnswer)}</bdi></p>` : `<label>Points for question ${i+1} (0–${manual.max})<input name="manual${i}" type="number" min="0" max="${manual.max}" step="0.5" value="${manual.score??''}" placeholder="Awaiting correction"></label>`}`;
        }).join('')}<label>Teacher feedback<textarea name="feedback" maxlength="2000">${esc(g.feedback)}</textarea></label><p class="muted">Leave a points field blank to keep that question awaiting correction. Final scores use 8 points.</p><button type="submit">Save corrections</button> <button type="submit" name="sendToClassroom" value="yes">Save and send grade to Classroom</button><p class="saveStatus" role="status" aria-live="polite"></p></form></details>`;
    }).join('');
}
form.addEventListener('submit',async event=>{
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    status.textContent = 'Loading answers…'; document.getElementById('reports').replaceChildren(); document.getElementById('export').hidden = true; records = [];
    try {
        const response = await fetch('/api/game-scores?game=assessment-retake-8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'report',password:form.elements.password.value})});
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Answers could not be loaded.');
        questions=result.questions; records = result.submissions;
        status.textContent = `${records.length} submission${records.length===1?'':'s'}. Questions 2–5 are graded automatically. Open a submission to correct questions 1 and 6.`;
        document.getElementById('export').hidden = !records.length; render();
    } catch(error) { status.textContent = error.message; }
    finally { button.disabled = false; }
});
document.getElementById('reports').addEventListener('submit',async event=>{
    event.preventDefault(); const correction=event.target;
    if(!correction.matches('.correction') || !correction.reportValidity())return;
    const r=records.find(item=>item.id===correction.dataset.id),message=correction.querySelector('.saveStatus'),buttons=[...correction.querySelectorAll('button')],sendToClassroom=event.submitter?.name==='sendToClassroom';
    buttons.forEach(button=>button.disabled=true);message.textContent=sendToClassroom?'Saving and sending grade…':'Saving corrections…';
    const scores=r.grading.manual.map(q=>{const value=correction.elements.namedItem('manual'+q.index).value;return value===''?null:Number(value);});
    try {
        const response=await fetch('/api/game-scores?game=assessment-retake-8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'correct',id:r.id,password:form.elements.password.value,scores,sendToClassroom,feedback:correction.elements.feedback.value})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Corrections were not saved.');
        r.grading=result.grading;document.getElementById('score-'+r.id).textContent=scoreText(r.grading);message.textContent='Corrections saved. '+scoreText(r.grading);
        if(result.classroomError)message.textContent+=' Classroom: '+result.classroomError;
        if(result.classroom)message.textContent+=' Grade sent to Classroom: '+result.classroom.score+'/'+result.classroom.maxPoints+'. '+(result.classroom.returned?'Work returned to the student.':result.classroom.returnPending?'Return is pending; retry or return it in Classroom.':'The student must mark the assignment done in Classroom; then send again to return it.');
    }catch(error){message.textContent=error.message+' Your unsaved corrections remain in the fields.';}
    finally{buttons.forEach(button=>button.disabled=false);}
});
document.getElementById('export').addEventListener('click',()=>{
    const columns = questions.map((q,i)=>`${i+1}. ${q.prompt}`);
    // Prevent answers or names being interpreted as spreadsheet formulas.
    const csvCell = v => { let s = String(v); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"'+s.replace(/"/g,'""')+'"'; };
    const rows = [['Name','School email','Submitted at','Receipt','Automatic (out of 5)','Q1 points','Q6 points','Final score (out of 8)','Questions awaiting correction','Teacher feedback',...columns],...records.map(r=>[r.name,r.email,r.submittedAt,r.id,r.grading.automaticScore,...r.grading.manual.map(q=>q.score??''),r.grading.total??'',r.grading.pending,r.grading.feedback,...r.answers.map(values=>values.join(' | '))])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'Gemara-8-Intro-Retake-submissions.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});

document.getElementById('classChoice').addEventListener('change',()=>{document.getElementById('classLink').hidden=true;});
