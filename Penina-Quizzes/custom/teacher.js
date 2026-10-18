'use strict';
let questions, records = [],reportRequest=0;
const form = document.getElementById('login'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const quizId=new URLSearchParams(location.search).get('quiz') || '';
const ACCOUNT_API='/api/game-scores?game=quiz-account&quiz='+encodeURIComponent(quizId);
const SUBMISSIONS_API='/api/game-scores?game=assessment-custom&quiz='+encodeURIComponent(quizId);
document.getElementById('studentQuiz').href='./?quiz='+encodeURIComponent(quizId);
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
        document.getElementById('reportClass').innerHTML='<option value="">All classes — submissions only</option>'+result.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.section?' — '+esc(c.section):''}</option>`).join('');
        if(!result.courses.length)connectionStatus.textContent+=' · No active classes taught by this account were found.';
    }catch(error){connectionStatus.textContent=error.message;}
    finally {
        // Never silently broaden a class-specific link to all classes.
        const params=new URLSearchParams(location.search),selectedCourse=params.get('course');
        const selector=document.getElementById('reportClass');
        if(selectedCourse) {
            if(![...selector.options].some(option=>option.value===selectedCourse))selector.add(new Option('Selected class (not in active class list)',selectedCourse));
            selector.value=selectedCourse;
        }
        if(params.get('mode')!=='assign')await loadReport();
    }
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
    return g.pending ? `Automatic: ${g.automaticScore}/${g.automaticMax} · ${g.pending} question${g.pending===1?'':'s'} awaiting correction` : `Final: ${g.total}/${g.baseMax} · Automatic: ${g.automaticScore}/${g.automaticMax}`;
}
function formatResultTime(value) {
    return new Date(value).toLocaleString('en-US', {timeZone:'America/New_York',timeZoneName:'short'});
}
function render() {
    records.sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt));
    document.getElementById('reports').innerHTML = records.map(r=>{
        const g=r.grading;
        return `<details class="card"><summary>${esc(r.name)} · ${esc(r.email)}<br><span id="score-${r.id}">${esc(scoreText(g))}</span></summary><p class="muted">Class: ${esc(r.className || 'Earlier submission')} · Submitted: ${esc(formatResultTime(r.submittedAt))} · Receipt: ${esc(r.id)}</p><form class="correction" data-id="${r.id}">${questions.map((q,i)=>{
            const auto=g.automatic.find(item=>item.index===i),manual=g.manual.find(item=>item.index===i);
            return QuizCorrection.question(q,i,r.answers[i],auto,manual,q.allowHalfCredit===true?0.5:1);
        }).join('')}<label>Teacher feedback<textarea name="feedback" maxlength="2000">${esc(g.feedback)}</textarea></label><p class="muted">Leave a points field blank to keep that question awaiting correction. Final scores use ${g.baseMax} regular points${g.extraMax?', plus up to '+g.extraMax+' extra-credit points':''}.</p><button type="submit">Save corrections</button> <button type="submit" name="sendToClassroom" value="yes">Save and send grade to Classroom</button><p class="muted">Email returns the corrected test to ${esc(r.email)}, including teacher overrides and your explanations. The answer key is not included.</p><button type="submit" name="emailStudent" value="yes">Save and email corrected test</button><p class="saveStatus" role="status" aria-live="polite"></p></form></details>`;
    }).join('');
}
function renderSummary() {
    document.getElementById('summaryPanel').hidden=false;
    document.getElementById('summaryCaption').textContent=records.length?`${records.length} submitted quiz${records.length===1?'':'zes'}. Counts and percentages update when you save corrections.`:'No submissions yet. Percentages will appear after students submit.';
    document.getElementById('summaryRows').innerHTML=questions.map((q,index)=>{
        const counts={correct:0,incorrect:0,partial:0,pending:0};
        for(const r of records){const item=[...r.grading.automatic,...r.grading.manual].find(v=>v.index===index);counts[!item || item.score===null?'pending':item.score===item.max?'correct':item.score===0?'incorrect':'partial']++;}
        const cell=n=>`${n} (${records.length?Math.round(n/records.length*1000)/10+'%':'—'})`;
        return `<tr><th scope="row"><span>Q${index+1}${q.extraCredit?' · Extra credit':''}</span><div class="summary-prompt" dir="auto">${esc(q.prompt)}</div></th>${Object.values(counts).map(n=>`<td>${cell(n)}</td>`).join('')}</tr>`;
    }).join('');
}
function renderRoster(roster) {
    document.getElementById('rosterPanel').hidden=false;
    const caption=document.getElementById('rosterCaption'),rows=document.getElementById('rosterRows');
    if(!roster){caption.textContent='Select a class above to see every enrolled student and their quiz status.';rows.replaceChildren();return;}
    const labels={'not-assigned':'Not assigned','not-started':'Not started','in-progress':'In progress',submitted:'Submitted',expired:'Time expired · not submitted'};
    const counts={};for(const s of roster.students)counts[s.status]=(counts[s.status] || 0)+1;
    caption.textContent=roster.className+' · '+roster.students.length+' enrolled students'+(roster.assigned?' · '+Object.entries(counts).map(([key,n])=>n+' '+labels[key].toLowerCase()).join(' · '):' · This quiz has not been assigned to this class.')+' · Use Load roster & results to refresh.';
    rows.innerHTML=[...roster.students].sort((a,b)=>(Date.parse(b.submittedAt)||0)-(Date.parse(a.submittedAt)||0)).map(s=>`<tr><th scope="row">${esc(s.name)}</th><td><span class="roster-status">${labels[s.status]}</span></td><td>${s.startedAt?esc(formatResultTime(s.startedAt)):'—'}</td><td>${s.submittedAt?esc(formatResultTime(s.submittedAt)):'—'}</td></tr>`).join('') || '<tr><td colspan="4">No students are enrolled in this class.</td></tr>';
}
async function loadReport() {
    const requestId=++reportRequest,button=form.querySelector('button[type="submit"]');button.disabled=true;
    status.textContent='Loading roster and results…';document.getElementById('reports').replaceChildren();document.getElementById('export').hidden=true;document.getElementById('summaryPanel').hidden=true;document.getElementById('rosterPanel').hidden=true;records=[];
    try {
        const response=await fetch(SUBMISSIONS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'report',courseId:document.getElementById('reportClass').value || undefined})});
        const result=await response.json();if(requestId!==reportRequest)return;if(!response.ok)throw new Error(result.error || 'Results could not be loaded.');
        questions=result.questions;records=result.submissions;document.querySelector('h1').textContent=result.title;
        status.textContent=`${records.length} submission${records.length===1?'':'s'}. Open a submission to review answers and mark written questions.`;
        document.getElementById('export').hidden=!records.length;render();renderRoster(result.roster);renderSummary();
    }catch(error){if(requestId===reportRequest)status.textContent=error.message;}
    finally{if(requestId===reportRequest)button.disabled=false;}
}
form.addEventListener('submit',event=>{event.preventDefault();loadReport();});
document.getElementById('reportClass').addEventListener('change',loadReport);
document.getElementById('reports').addEventListener('submit',async event=>{
    event.preventDefault(); const correction=event.target;
    if(!correction.matches('.correction') || !correction.reportValidity())return;
    const r=records.find(item=>item.id===correction.dataset.id),message=correction.querySelector('.saveStatus'),buttons=[...correction.querySelectorAll('button')],sendToClassroom=event.submitter?.name==='sendToClassroom',emailStudent=event.submitter?.name==='emailStudent';
    buttons.forEach(button=>button.disabled=true);message.textContent=emailStudent?'Saving and emailing corrected test…':sendToClassroom?'Saving and sending grade…':'Saving corrections…';
    const scores=r.grading.manual.map(q=>{const value=correction.elements.namedItem('manual'+q.index).value;return value===''?null:Number(value);});
    try {
        const response=await fetch(SUBMISSIONS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'correct',id:r.id,scores,overrides:QuizCorrection.overrides(correction),explanations:QuizCorrection.explanations(correction),emailStudent,sendToClassroom,feedback:correction.elements.feedback.value})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Corrections were not saved.');
        r.grading=result.grading;renderSummary();document.getElementById('score-'+r.id).textContent=scoreText(r.grading);message.textContent='Corrections saved. '+scoreText(r.grading);
        if(result.email)message.textContent+=' Corrected test accepted for email delivery to '+result.email.to+'.';
        if(result.emailError)message.textContent+=' Email not sent: '+result.emailError+' Your corrections are saved; you can retry emailing.';
        if(result.classroomError)message.textContent+=' Classroom: '+result.classroomError;
        if(result.classroom)message.textContent+=' Grade sent to Classroom: '+result.classroom.score+'/'+result.classroom.maxPoints+'. '+(result.classroom.returned?'Work returned to the student.':result.classroom.returnPending?'Return is pending; retry or return it in Classroom.':'The student must mark the assignment done in Classroom; then send again to return it.');
    }catch(error){message.textContent=error.message+' Your unsaved corrections remain in the fields.';}
    finally{buttons.forEach(button=>button.disabled=false);}
});
document.getElementById('export').addEventListener('click',()=>{
    const columns = questions.map((q,i)=>`${i+1}. ${q.extraCredit?'[Extra credit] ':''}${q.prompt}`);
    // Prevent answers or names being interpreted as spreadsheet formulas.
    const csvCell = v => { let s = String(v); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"'+s.replace(/"/g,'""')+'"'; };
    const rows = [['Name','School email','Submitted at (Eastern Time)','Receipt','Automatic points',...questions.flatMap((q,i)=>q.type==='text'?['Q'+(i+1)+' points']:[]),'Final score','Questions awaiting correction','Teacher feedback',...columns],...records.map(r=>[r.name,r.email,formatResultTime(r.submittedAt),r.id,r.grading.automaticScore,...r.grading.manual.map(q=>q.score??''),r.grading.total??'',r.grading.pending,r.grading.feedback,...r.answers.map(values=>values.join(' | '))])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'PP-Quiz-submissions.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});

document.getElementById('classChoice').addEventListener('change',()=>{document.getElementById('classLink').hidden=true;});
