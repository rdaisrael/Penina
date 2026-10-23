'use strict';
let questions, records = [];
const form = document.getElementById('login'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const ACCOUNT_API='/api/game-scores?game=quiz-account&quiz=gemara-6-intro-retake';
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
    const score=g.pending ? `${g.pending} question${g.pending===1?'':'s'} awaiting correction` : `Final: ${g.total}/${g.baseMax}`;
    const lms=g.lmsSentAt ? 'Sent to LMS' : '';
    const student=g.studentSentAt ? 'Emailed to Student' : '';
    return [score,lms,student].filter(Boolean).join('\u2003\u2003');
}
function formatResultTime(value) {
    return new Date(value).toLocaleString('en-US', {timeZone:'America/New_York',timeZoneName:'short'});
}
function render() {
    records.sort(QuizCorrection.compareStudents);
    document.getElementById('reports').innerHTML = records.map(r=>{
        const g=r.grading;
        return `<details name="student-responses" class="card"><summary>${esc(r.name)} · ${esc(r.email)}<br><span id="score-${r.id}">${esc(scoreText(g))}</span></summary><p class="muted">Class: ${esc(r.className || 'Earlier submission')} · Submitted: ${esc(formatResultTime(r.submittedAt))} · Receipt: ${esc(r.id)}</p><form class="correction" data-id="${r.id}" data-classroom-draft="${g.classroomDraft===true}">${questions.map((q,i)=>{
            const auto=g.automatic.find(item=>item.index===i),manual=g.manual.find(item=>item.index===i);
            return QuizCorrection.question(q,i,r.answers[i],auto,manual,0.5);
        }).join('')}<label>Teacher feedback<textarea name="feedback" maxlength="2000">${esc(g.feedback)}</textarea></label><p class="muted">Leave a points field blank to keep that question awaiting correction. Final scores use 8 points.</p><button type="submit">Save corrections</button> <button type="submit" name="sendToClassroom" value="yes">Save and send draft to Classroom</button><p class="muted">After saving the current grading as a draft in Classroom, send the corrected test to ${esc(r.email)}, including teacher overrides and your explanations. The answer key is not included.</p><button type="submit" name="emailStudent" value="yes" ${g.classroomDraft?'':'disabled'}>Send Email</button><p class="saveStatus" role="status" aria-live="polite"></p></form></details>`;
    }).join('');
}
form.addEventListener('submit',async event=>{
    event.preventDefault(); const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    status.textContent = 'Loading answers…'; document.getElementById('reports').replaceChildren(); document.getElementById('export').hidden = true; records = [];
    try {
        const response = await fetch('/api/game-scores?game=assessment-retake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'report',password:form.elements.password.value})});
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Answers could not be loaded.');
        questions=result.questions; records = result.submissions.filter(r=>!new URLSearchParams(location.search).get('class') || r.classId===new URLSearchParams(location.search).get('class'));
        status.textContent = `${records.length} submission${records.length===1?'':'s'}. Questions 2–5 are graded automatically. Open a submission to correct questions 1 and 6.`;
        document.getElementById('export').hidden = !records.length; render();
    } catch(error) { status.textContent = error.message; }
    finally { button.disabled = false; }
});
document.getElementById('reports').addEventListener('submit',async event=>{
    event.preventDefault(); const correction=event.target;
    if(!correction.matches('.correction') || !correction.reportValidity())return;
    const r=records.find(item=>item.id===correction.dataset.id),message=correction.querySelector('.saveStatus'),buttons=[...correction.querySelectorAll('button')],sendToClassroom=event.submitter?.name==='sendToClassroom',emailStudent=event.submitter?.name==='emailStudent';
    if(emailStudent && correction.dataset.classroomDraft!=='true')return;
    const fields=[...correction.querySelectorAll('input, textarea')];
    fields.forEach(field=>field.disabled=true);
    buttons.forEach(button=>button.disabled=true);message.textContent=emailStudent?'Sending email…':sendToClassroom?'Saving and sending grade…':'Saving corrections…';
    const scores=r.grading.manual.map(q=>{const value=correction.elements.namedItem('manual'+q.index).value;return value===''?null:Number(value);});
    try {
        const response=await fetch('/api/game-scores?game=assessment-retake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'correct',id:r.id,password:form.elements.password.value,scores,overrides:QuizCorrection.overrides(correction),explanations:QuizCorrection.explanations(correction),emailStudent,sendToClassroom,feedback:correction.elements.feedback.value})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Corrections were not saved.');
        correction.dataset.classroomDraft=String(result.grading.classroomDraft===true);
        r.grading=result.grading;document.getElementById('score-'+r.id).textContent=scoreText(r.grading);message.textContent=(emailStudent?'':'Corrections saved. ')+scoreText(r.grading);
        if(result.email)message.textContent+=' Corrected test accepted for email delivery to '+result.email.to+'.';
        if(result.emailError)message.textContent+=' Email not sent: '+result.emailError+' Your corrections are saved; you can retry emailing.';
        if(result.classroomError)message.textContent+=' Classroom: '+result.classroomError;
        if(result.classroom)message.textContent+=' Draft grade saved to Classroom: '+result.classroom.score+'/'+result.classroom.maxPoints+'.';
        if(emailStudent && result.email && !result.emailError && !result.classroomError && r.grading.pending===0) {
            const submission=correction.closest('details');
            submission.open=false;
            const next=submission.nextElementSibling;
            if(next?.matches('details')) {
                next.open=true;
                next.scrollIntoView({block:'start'});
                next.querySelector('summary').focus({preventScroll:true});
            } else {
                submission.querySelector('summary').focus({preventScroll:true});
            }
        }
    }catch(error){message.textContent=error.message+' Your unsaved corrections remain in the fields.';}
    finally{fields.forEach(field=>field.disabled=false);buttons.forEach(button=>button.disabled=button.name==='emailStudent' && correction.dataset.classroomDraft!=='true');}
});
document.getElementById('export').addEventListener('click',()=>{
    const columns = questions.map((q,i)=>`${i+1}. ${q.prompt}`);
    // Prevent answers or names being interpreted as spreadsheet formulas.
    const csvCell = v => { let s = String(v); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"'+s.replace(/"/g,'""')+'"'; };
    const rows = [['Name','School email','Submitted at (Eastern Time)','Receipt','Automatic (out of 5)','Q1 points','Q6 points','Final score (out of 8)','Questions awaiting correction','Teacher feedback',...columns],...records.map(r=>[r.name,r.email,formatResultTime(r.submittedAt),r.id,r.grading.automaticScore,...r.grading.manual.map(q=>q.score??''),r.grading.total??'',r.grading.pending,r.grading.feedback,...r.answers.map(values=>values.join(' | '))])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'Gemara-6-Intro-Retake-submissions.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});

document.getElementById('classChoice').addEventListener('change',()=>{document.getElementById('classLink').hidden=true;});
