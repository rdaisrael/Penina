'use strict';
let questions, records = [];
const form = document.getElementById('login'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const ACCOUNT_API='/api/game-scores?game=quiz-account';
const connectionStatus=document.getElementById('connectionStatus');
async function accountRequest(action,body) {
    const response=await fetch(ACCOUNT_API+(body?'':'&action='+action),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action})}:{});
    const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
(async()=>{
    try {
        const config=await accountRequest('config');
        if(!config.configured){connectionStatus.textContent='Google Classroom connection is awaiting one-time setup by the site owner.';document.querySelector('#connectGoogle button[type="submit"]').disabled=true;return;}
        const result=await accountRequest('courses');
        connectionStatus.textContent='Connected as '+result.email;
        document.getElementById('connectGoogle').hidden=true;
        document.getElementById('chooseClass').hidden=false;
        document.getElementById('classChoice').innerHTML='<option value="">Choose a class</option>'+result.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.section?' — '+esc(c.section):''}</option>`).join('');
        if(!result.courses.length)connectionStatus.textContent+=' · No active classes taught by this account were found.';
    }catch(error){connectionStatus.textContent=error.message;}
})();
document.getElementById('connectGoogle').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.target.querySelector('button[type="submit"]');button.disabled=true;
    try{const result=await accountRequest('login',{role:'teacher',password:event.target.elements.password.value});location.assign(result.url);}
    catch(error){connectionStatus.textContent=error.message;button.disabled=false;}
});
document.getElementById('chooseClass').addEventListener('submit',async event=>{
    event.preventDefault();document.getElementById('classLink').hidden=true;const button=event.target.querySelector('button[type="submit"]');button.disabled=true;
    try{
        const result=await accountRequest('assign',{courseId:document.getElementById('classChoice').value});
        document.getElementById('studentLink').value=result.url;document.getElementById('classroom').href=result.classroomURL;
        document.getElementById('classLink').hidden=false;connectionStatus.textContent=(result.state==='DRAFT'?'Draft created. Open Classroom to review and assign it to ':'Assignment ready for ')+result.className+'. Use this assignment for grade transfer.';
    }catch(error){connectionStatus.textContent=error.message;}finally{button.disabled=false;}
});
function scoreText(g) {
    return g.pending ? `Multiple choice: ${g.automaticScore}/10 · ${g.pending} question${g.pending===1?'':'s'} awaiting correction` : `Final: ${g.total}/12 (includes extra credit) · Multiple choice: ${g.automaticScore}/10`;
}
function formatResultTime(value) {
    return new Date(value).toLocaleString('en-US', {timeZone:'America/New_York',timeZoneName:'short'});
}
function render() {
    records.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}) || a.id.localeCompare(b.id));
    document.getElementById('reports').innerHTML = records.map(r=>{
        const g=r.grading;
        return `<details class="card"><summary>${esc(r.name)} · ${esc(r.email)}<br><span id="score-${r.id}">${esc(scoreText(g))}</span></summary><p class="muted">Class: ${esc(r.className || 'Earlier submission')} · Submitted: ${esc(formatResultTime(r.submittedAt))} · Receipt: ${esc(r.id)}</p><form class="correction" data-id="${r.id}">${questions.map((q,i)=>{
            const auto=g.automatic.find(item=>item.index===i),manual=g.manual.find(item=>item.index===i);
            return QuizCorrection.question(q,i,r.answers[i],auto,manual,0.5);
        }).join('')}<label>Teacher feedback<textarea name="feedback" maxlength="2000">${esc(g.feedback)}</textarea></label><p class="muted">Leave a points field blank to keep that question awaiting correction. Final scores use 12 regular points, plus up to 4 extra-credit points.</p><button type="submit">Save corrections</button> <button type="submit" name="sendToClassroom" value="yes">Save and send grade to Classroom</button><p class="muted">Email returns the corrected test to ${esc(r.email)}, including teacher overrides and your explanations. The answer key is not included.</p><button type="submit" name="emailStudent" value="yes">Save and email corrected test</button><p class="saveStatus" role="status" aria-live="polite"></p></form></details>`;
    }).join('');
}
form.addEventListener('submit',async event=>{
    event.preventDefault(); const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    status.textContent = 'Loading answers…'; document.getElementById('reports').replaceChildren(); document.getElementById('export').hidden = true; records = [];
    try {
        const response = await fetch('/api/game-scores?game=assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'report',password:form.elements.password.value})});
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Answers could not be loaded.');
        questions=result.questions; records = result.submissions.filter(r=>!new URLSearchParams(location.search).get('class') || r.classId===new URLSearchParams(location.search).get('class'));
        status.textContent = `${records.length} submission${records.length===1?'':'s'}. Multiple-choice answers are graded automatically. Open a submission to correct written answers and extra credit.`;
        document.getElementById('export').hidden = !records.length; render();
    } catch(error) { status.textContent = error.message; }
    finally { button.disabled = false; }
});
document.getElementById('reports').addEventListener('submit',async event=>{
    event.preventDefault(); const correction=event.target;
    if(!correction.matches('.correction') || !correction.reportValidity())return;
    const r=records.find(item=>item.id===correction.dataset.id),message=correction.querySelector('.saveStatus'),buttons=[...correction.querySelectorAll('button')],sendToClassroom=event.submitter?.name==='sendToClassroom',emailStudent=event.submitter?.name==='emailStudent';
    buttons.forEach(button=>button.disabled=true);message.textContent=emailStudent?'Saving and emailing corrected test…':sendToClassroom?'Saving and sending grade…':'Saving corrections…';
    const scores=r.grading.manual.map(q=>{const value=correction.elements.namedItem('manual'+q.index).value;return value===''?null:Number(value);});
    try {
        const response=await fetch('/api/game-scores?game=assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'correct',id:r.id,password:form.elements.password.value,scores,overrides:QuizCorrection.overrides(correction),explanations:QuizCorrection.explanations(correction),emailStudent,sendToClassroom,feedback:correction.elements.feedback.value})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Corrections were not saved.');
        r.grading=result.grading;document.getElementById('score-'+r.id).textContent=scoreText(r.grading);message.textContent='Corrections saved. '+scoreText(r.grading);
        if(result.email)message.textContent+=' Corrected test accepted for email delivery to '+result.email.to+'.';
        if(result.emailError)message.textContent+=' Email not sent: '+result.emailError+' Your corrections are saved; you can retry emailing.';
        if(result.classroomError)message.textContent+=' Classroom: '+result.classroomError;
        if(result.classroom)message.textContent+=' Grade sent to Classroom: '+result.classroom.score+'/12. '+(result.classroom.returned?'Work returned to the student.':result.classroom.returnPending?'Return is pending; retry or return it in Classroom.':'The student must mark the assignment done in Classroom; then send again to return it.');
    }catch(error){message.textContent=error.message+' Your unsaved corrections remain in the fields.';}
    finally{buttons.forEach(button=>button.disabled=false);}
});
document.getElementById('export').addEventListener('click',()=>{
    const columns = questions.flatMap((q,i)=>(q.fields||['Answer']).map(f=>`${i+1}. ${q.prompt} — ${f}`));
    // Prevent answers or names being interpreted as spreadsheet formulas.
    const csvCell = v => { let s = String(v); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"'+s.replace(/"/g,'""')+'"'; };
    const rows = [['Name','School email','Submitted at (Eastern Time)','Receipt','Multiple choice (out of 10)','Q3 points','Q6 points','Q13 extra credit','Q14 extra credit','Final score (out of 12, including extra credit)','Questions awaiting correction','Teacher feedback',...columns],...records.map(r=>[r.name,r.email,formatResultTime(r.submittedAt),r.id,r.grading.automaticScore,...r.grading.manual.map(q=>q.score??''),r.grading.total??'',r.grading.pending,r.grading.feedback,...r.answers.flat()])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'Gemara-6-Quiz-WL-2-submissions.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});

document.getElementById('classChoice').addEventListener('change',()=>{document.getElementById('classLink').hidden=true;});
