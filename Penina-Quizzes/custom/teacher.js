'use strict';
let ungraded=false;
let questions, records = [],currentRoster=null,reportRequest=0;
const form = document.getElementById('login'), status = document.getElementById('status');
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const quizId=new URLSearchParams(location.search).get('quiz') || '';
const ACCOUNT_API='/api/game-scores?game=quiz-account&quiz='+encodeURIComponent(quizId);
const SUBMISSIONS_API='/api/game-scores?game=assessment-custom&quiz='+encodeURIComponent(quizId);
const connectionStatus=document.getElementById('connectionStatus');
async function accountRequest(action,body) {
    const response=await fetch(ACCOUNT_API+(body?'':'&action='+action),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action})}:{});
    const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
(async()=>{
    try {
        const config=await accountRequest('config');
        if(config.gradingMode==='ungraded')setGradingMode(config.gradingMode);
        if(!config.configured){connectionStatus.textContent='Google Classroom connection is awaiting one-time setup by the site owner.';document.querySelector('#connectGoogle button[type="submit"]').disabled=true;return;}
        const result=await accountRequest('courses');
        connectionStatus.textContent='Connected as '+result.email;
        document.getElementById('connectGoogle').hidden=true;
        document.getElementById('chooseClass').hidden=false;
        document.getElementById('classChoice').innerHTML='<option value="">Choose a class</option>'+result.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.section?' — '+esc(c.section):''}</option>`).join('');
        if(!result.courses.length)connectionStatus.textContent+=' · No active classes taught by this account were found.';
    }catch(error){connectionStatus.textContent=error.message;}
    finally {
        // Never silently broaden a class-specific link to all classes.
        const params=new URLSearchParams(location.search),selectedCourse=params.get('course');
        const selector=document.getElementById('reportClass');
        if(params.get('mode')!=='assign') {
            try {
                const result=await accountRequest('assignments');
                const classes=new Map(result.assignments.filter(a=>a.quiz===quizId).map(a=>[a.courseId,a.className]));
                selector.innerHTML='<option value="">All assigned classes — submissions only</option>';
                for(const [id,name] of [...classes].sort((a,b)=>a[1].localeCompare(b[1])))selector.add(new Option(name,id));
            }catch(error){connectionStatus.textContent=error.message;}
        }
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
        document.getElementById('classLink').hidden=false;connectionStatus.textContent=(result.state==='DRAFT'?'Draft created. Open Classroom to review and assign it to ':'Assignment ready for ')+result.className+(ungraded?'. This quiz is not graded.':'. Use this assignment for grade transfer.');
    }catch(error){connectionStatus.textContent=error.message;}finally{button.disabled=false;}
});
function setGradingMode(mode){
    ungraded=mode==='ungraded';
    document.getElementById('reportHeading').textContent=ungraded?'Review responses in Penina':'Review and grade in Penina';
    document.getElementById('reportDescription').textContent=ungraded?'This quiz is not graded. Review student answers, save feedback, and email it to students.':'Use the Google teacher account that created this quiz. Written and recorded answers need teacher correction; questions with answer choices are graded automatically.';
    document.querySelectorAll('[data-grading-column],.results-jump-links').forEach(el=>el.hidden=ungraded);
}
function ungradedQuestion(q,i,answers){
    return `<section class="review-question"><p class="question-number">Question ${q.number}</p><h2 class="review-prompt" dir="auto">${esc(q.prompt)}</h2>${QuizRecording.content(q)}${q.image?QuizPicture.render(q):''}${QuizQuestionAudio.render(q)}<div class="student-response"><h3>Student’s answer</h3>${q.type==='recording'?QuizRecording.player(i,answers[0],'',q.recordingDeleted,true):answers.map((a,j)=>`<p dir="auto">${esc((q.pictureResponseMode==='markers'?'Marker '+(j+1)+': ':'')+(a || '(No answer)'))}</p>`).join('')}</div></section>`;
}
function scoreText(g) {
    if(g.gradingMode==='ungraded')return 'Not graded'+(g.studentSentAt?' · Feedback emailed to student':'');
    const score=g.pending ? `${g.pending} question${g.pending===1?'':'s'} awaiting correction` : `Final: ${g.total}/${g.baseMax}`;
    const lms=g.lmsSentAt ? 'Sent to LMS' : '';
    const student=g.studentSentAt ? 'Emailed to Student' : '';
    return [score,g.pointsChanged?'Potential points changed — review and resend grades':'',lms,student].filter(Boolean).join('\u2003\u2003');
}
function formatResultTime(value) {
    return new Date(value).toLocaleString('en-US', {timeZone:'America/New_York',timeZoneName:'short'});
}
function render() {
    records.sort(QuizCorrection.compareStudents);
    document.getElementById('reports').innerHTML = records.map(r=>{
        const g=r.grading;let number=0;
        return `<details name="student-responses" class="card" id="submission-${esc(r.id)}"><summary>${esc(r.name)} · ${esc(r.email)}${ungraded?'':QuizCorrection.correctionArrow('first')}<br><span id="score-${r.id}">${esc(scoreText(g))}</span></summary><p class="muted">Class: ${esc(r.className || 'Earlier submission')} · Submitted: ${esc(formatResultTime(r.submittedAt))} · Receipt: ${esc(r.id)}</p>${ungraded?'<p class="reviewStatus" role="status"></p>':''}<form class="correction" data-grading-mode="${ungraded?'ungraded':'graded'}" data-id="${r.id}" data-classroom-draft="${g.classroomDraft===true}">${questions.map((q,i)=>{
            if(q.type==='section')return `<section class="section-content"><p class="muted">Title/Section Page</p>${q.prompt?`<h2 class="review-prompt" dir="${q.direction==='rtl'?'rtl':'ltr'}">${esc(q.prompt)}</h2>`:''}${q.content?`<p class="section-paragraph" dir="${q.direction==='rtl'?'rtl':'ltr'}">${esc(q.content)}</p>`:''}${q.image?QuizPicture.render(q):''}${QuizQuestionAudio.render(q)}</section>`;
            number++;
            const auto=g.automatic.find(item=>item.index===i),manual=g.manual.find(item=>item.index===i);
            if(ungraded)return ungradedQuestion({...q,number,recordingDeleted:r.deletedRecordings?.includes(i)},i,q.type==='match'?r.answers[i].map((v,j)=>q.items[j]+': '+(v || '(Unanswered)')):r.answers[i]);
            return QuizCorrection.question({...q,number,recordingDeleted:r.deletedRecordings?.includes(i)},i,q.type==='match'?r.answers[i].map((v,j)=>q.items[j]+': '+(v || '(Unanswered)')):r.answers[i],auto,manual,auto?.step ?? (q.allowHalfCredit===true?0.5:1));
        }).join('')}<label>Teacher feedback<textarea name="feedback" maxlength="2000">${esc(g.feedback)}</textarea></label>${ungraded?`<button type="submit">Save feedback</button><p class="muted">Save and email your teacher feedback to ${esc(r.email)}.</p><button type="submit" name="emailStudent" value="yes">Save and email feedback</button>`:`<p class="muted">Leave a points field blank to keep that question awaiting correction. Final scores use ${g.baseMax} regular points${g.extraMax?', plus up to '+g.extraMax+' extra-credit points':''}.</p><button type="submit">Save corrections</button> <button type="submit" name="sendToClassroom" value="yes">Save and send draft to Classroom</button><p class="muted">After saving the current grading as a draft in Classroom, send the corrected test to ${esc(r.email)}, including teacher overrides and your explanations. The answer key is not included.</p><button type="submit" name="emailStudent" value="yes" ${g.classroomDraft?'':'disabled'}>Send Email</button>`}<p class="saveStatus" role="status" aria-live="polite"></p></form></details>`;
    }).join('');
}
function renderSummary() {
    if(ungraded){document.getElementById('summaryPanel').hidden=true;return;}
    renderResultsGrid();
    document.getElementById('summaryPanel').hidden=false;
    document.getElementById('summaryCaption').textContent=records.length?`${records.length} submitted quiz${records.length===1?'':'zes'}. Counts and percentages update when you save corrections.`:'No submissions yet. Percentages will appear after students submit.';
    let number=0;
    document.getElementById('summaryRows').innerHTML=questions.map((q,index)=>{
        if(q.type==='section')return '';
        number++;
        const counts={correct:0,incorrect:0,partial:0,pending:0};
        for(const r of records){const item=[...r.grading.automatic,...r.grading.manual].find(v=>v.index===index);counts[resultState(item)]++;}
        const parts=renderPartSummary({...q,number},index);
        const matches=q.type==='match' && !parts?`<div class="summary-matches"><span>Correct matches:</span><ul>${q.items.map((word,i)=>`<li><bdi dir="auto">${esc(word)}</bdi> — <bdi dir="auto">${esc(q.answer[i])}</bdi></li>`).join('')}</ul></div>`:'';
        return `<tr><th scope="row"><span>Q${number}${q.extraCredit?' · Extra credit':''}</span><div class="summary-prompt" dir="auto">${esc(q.prompt)}</div>${matches}</th>${Object.values(counts).map(n=>`<td>${summaryCount(n)}</td>`).join('')}</tr>${parts}`;
    }).join('');
}
function summaryCount(n) {
    return `${n} (${records.length?Math.round(n/records.length*1000)/10+'%':'—'})`;
}
function renderPartSummary(q,index) {
    // Written answers have only a question-level teacher mark, not per-part correctness.
    if(!['match','gaps','order','multi'].includes(q.type) || q.type==='gaps' && q.wordBank===false)return '';
    if(!['response','proportional'].includes(q.scoringMode))return '';
    if((q.type==='order' || q.type==='multi') && !q.perResponseCredit)return '';
    if(q.answer.filter(Boolean).length<2)return '';
    const parts=(q.type==='multi'?q.choices:q.answer).flatMap((answer,part)=>{
        if(answer==='')return [];
        const selected=q.type==='multi' && q.answer.includes(answer);
        const label=q.type==='match'?`Part ${part+1}`:q.type==='gaps'?`Blank ${part+1}`:q.type==='order'?`Position ${part+1}`:`Choice ${part+1}`;
        const key=q.type==='match'?`<bdi dir="auto">${esc(q.items[part])}</bdi> — <bdi dir="auto">${esc(answer)}</bdi>`:`<bdi dir="auto">${esc(answer)}</bdi>${q.type==='multi'?` — ${selected?'Select':'Leave unselected'}`:''}`;
        const correct=records.filter(record=>{
            const responses=record.answers?.[index] || [];
            return q.type==='multi'?responses.includes(answer)===selected:responses[part]===answer;
        }).length;
        return [`<tr><th scope="row"><span class="summary-part-label">${label}</span><span class="summary-part-answer">${key}</span></th><td data-result="correct">${summaryCount(correct)}</td><td data-result="incorrect">${summaryCount(records.length-correct)}</td></tr>`];
    }).join('');
    return `<tr class="summary-breakdown"><td colspan="5"><div class="summary-parts"><p class="summary-parts-heading">Q${q.number ?? index+1} · Breakdown by part</p><table class="summary-parts-table" aria-label="Question ${q.number ?? index+1} breakdown by part"><thead><tr><th scope="col">Part / correct answer</th><th scope="col">Correct</th><th scope="col">Wrong</th></tr></thead><tbody>${parts}</tbody></table></div></td></tr>`;
}
function resultState(item) {
    return !item || item.score==null?'pending':item.score>=(item.correctnessMax ?? item.max)?'correct':item.score===0?'incorrect':'partial';
}
function renderResultsGrid() {
    const labels={correct:'Correct',incorrect:'Incorrect',partial:'Partial credit',pending:'Teacher will correct',missing:'Not submitted'};
    const symbols={correct:'✓',incorrect:'✕',partial:'◐',pending:'…',missing:'—'};
    const head=document.getElementById('resultsHead');
    let number=0;
    head.innerHTML='<tr><th scope="col">Student</th><th scope="col">Grade</th>'+questions.map((q,i)=>q.type==='section'?'':`<th scope="col"><button type="button" data-question="${i}" title="${esc(q.prompt)}" aria-label="Question ${++number}${q.extraCredit?', extra credit':''}: ${esc(q.prompt)}">${number}${q.extraCredit?'<span class="results-bonus">Bonus</span>':''}</button></th>`).join('')+'</tr>';
    const showQuestion=event=>{
        const button=event.target.closest('button[data-question]');
        if(!button)return;
        const index=Number(button.dataset.question),q=questions[index];
        document.getElementById('resultsQuestion').textContent=`Question ${questions.slice(0,index+1).filter(q=>q.type!=='section').length}${q.extraCredit?' · Extra credit':''}: ${q.prompt}`;
    };
    head.onmouseover=showQuestion;head.onfocusin=showQuestion;head.onclick=showQuestion;
    document.getElementById('resultsQuestion').textContent='Select a question number to read its text.';
    const byId=new Map(records.map(r=>[r.id,r]));
    const represented=new Set();
    const students=(currentRoster?.students || []).map(student=>{
        const record=byId.get(student.submissionId);
        if(record)represented.add(record.id);
        return {...student,record};
    });
    for(const record of records)if(!represented.has(record.id))students.push({...record,record});
    students.sort(QuizCorrection.compareStudents);
    document.getElementById('resultsRows').innerHTML=students.map(student=>{
        const record=student.record,g=record?.grading;
        const grade=!g?'Not submitted':g.pending?`${g.pending} awaiting correction`:`${g.total} / ${g.baseMax}`;
        const items=new Map(g?[...g.automatic,...g.manual].map(item=>[item.index,item]):[]);
        const name=record?`<a href="#submission-${esc(record.id)}" data-submission="${esc(record.id)}">${esc(student.name)}</a>`:esc(student.name);
        return `<tr><th scope="row">${name}</th><td>${esc(grade)}</td>`+questions.map((q,index)=>{
            if(q.type==='section')return '';
            const item=items.get(index),state=record?resultState(item):'missing';
            const points=state==='missing'?'':state==='pending'?'Teacher will correct':`${item.score} / ${item.max}`;
            const description=`${labels[state]}${points?' · '+points:''}`;
            return `<td data-result="${state}" title="${esc(description)}" aria-label="${esc(description)}"><span aria-hidden="true">${symbols[state]}</span> ${esc(points)}</td>`;
        }).join('')+'</tr>';
    }).join('') || `<tr><td colspan="${questions.filter(q=>q.type!=='section').length+2}">No students or submissions to show yet.</td></tr>`;
}
function renderRoster(roster) {
    document.getElementById('rosterPanel').hidden=false;
    const caption=document.getElementById('rosterCaption'),rows=document.getElementById('rosterRows');
    if(!roster){caption.textContent='Select a class above to see every enrolled student and their quiz status.';rows.replaceChildren();return;}
    const labels={'not-assigned':'Not assigned','not-started':'Not started','in-progress':'In progress',submitted:'Submitted',expired:'Time expired · not submitted'};
    const counts={};for(const s of roster.students)counts[s.status]=(counts[s.status] || 0)+1;
    caption.textContent=roster.className+' · '+roster.students.length+' enrolled students'+(roster.assigned?' · '+Object.entries(counts).map(([key,n])=>n+' '+labels[key].toLowerCase()).join(' · '):' · This quiz has not been assigned to this class.')+' · Use Load roster & results to refresh.';
    const submissions=new Map(records.map(record=>[record.id,record]));
    rows.innerHTML=[...roster.students].sort(QuizCorrection.compareStudents).map(s=>{
        const submission=submissions.get(s.submissionId),graded=submission?.grading.savedAt && submission.grading.pending===0;
        const name=submission?`<a href="#submission-${esc(submission.id)}" data-submission="${esc(submission.id)}">${esc(s.name)}</a>`:esc(s.name);
        return `<tr><th scope="row">${name}</th><td><span class="roster-status">${labels[s.status]}</span></td><td>${s.startedAt?esc(formatResultTime(s.startedAt)):'—'}</td><td>${s.submittedAt?esc(formatResultTime(s.submittedAt)):'—'}</td>${ungraded?'':`<td>${graded?'<span class="graded-check" role="img" aria-label="Graded" title="Graded">✓</span>':'<span aria-label="Not graded">—</span>'}</td><td>${submission?.grading.lmsSentAt?'<span class="graded-check" role="img" aria-label="Sent to LMS" title="Sent to LMS">✓</span>':'—'}</td>`}<td>${submission?.grading.studentSentAt?'<span class="graded-check" role="img" aria-label="Emailed to student" title="Emailed to student">✓</span>':'—'}</td></tr>`;
    }).join('') || `<tr><td colspan="${ungraded?5:7}">No students are enrolled in this class.</td></tr>`;
}
async function loadReport() {
    const requestId=++reportRequest,button=form.querySelector('button[type="submit"]');button.disabled=true;
    status.textContent='Loading roster and results…';document.getElementById('reports').replaceChildren();document.getElementById('export').hidden=true;document.getElementById('summaryPanel').hidden=true;document.getElementById('rosterPanel').hidden=true;records=[];
    try {
        const response=await fetch(SUBMISSIONS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'report',courseId:document.getElementById('reportClass').value || undefined})});
        const result=await response.json();if(requestId!==reportRequest)return;if(!response.ok)throw new Error(result.error || 'Results could not be loaded.');
        setGradingMode(result.gradingMode);questions=result.questions;records=result.submissions;document.querySelector('h1').textContent=result.title;
        document.getElementById('recordingRetention').hidden=!questions.some(q=>q.type==='recording');
        status.textContent=`${records.length} submission${records.length===1?'':'s'}. ${ungraded?'Not graded. Open a submission to review answers.':'Open a submission to review answers and mark written and recorded answers.'}`;
        document.getElementById('export').hidden=!records.length;currentRoster=result.roster;render();renderRoster(currentRoster);renderSummary();
    }catch(error){if(requestId===reportRequest)status.textContent=error.message;}
    finally{if(requestId===reportRequest)button.disabled=false;}
}
form.addEventListener('submit',event=>{event.preventDefault();loadReport();});
document.getElementById('reportClass').addEventListener('change',loadReport);
document.getElementById('deleteRecordings').addEventListener('click',async event=>{
    const button=event.currentTarget,message=document.getElementById('recordingRetentionStatus');
    button.disabled=true;message.textContent='Checking recordings across all classes…';
    const send=async body=>{
        const response=await fetch(SUBMISSIONS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
        const result=await response.json();if(!response.ok)throw Error(result.error || 'Recording deletion could not finish. Review and retry.');return result;
    };
    try{
        const preview=await send({action:'recordings-delete-preview'});
        if(!preview.count){message.textContent='There are no stored recordings for this quiz.';return;}
        const size=(preview.bytes/1024/1024).toFixed(1);
        if(!confirm(`Permanently delete ${preview.count} recording(s) (${size} MB) for this quiz across ALL classes?\n\nThis includes practice recordings, replaced takes, and unfinished attempts. Wait until all students finish; deleting audio from unfinished attempts can prevent submission. Download any recordings you want to keep first.\n\nGrades, feedback, written answers, and the quiz will remain. This cannot be undone.`)){message.textContent='Deletion canceled. Recordings were kept.';return;}
        message.textContent='Deleting recordings…';
        const result=await send({action:'recordings-delete',token:preview.token,confirmPermanentDeletion:true});
        await loadReport();message.textContent=`Deleted ${result.deleted} recording(s). Grades, feedback, and written answers were kept.`;
    }catch(error){message.textContent=error.message;}
    finally{button.disabled=false;}
});
document.getElementById('reports').addEventListener('submit',async event=>{
    event.preventDefault(); const correction=event.target;
    if(!correction.matches('.correction') || !correction.reportValidity())return;
    const r=records.find(item=>item.id===correction.dataset.id),message=correction.querySelector('.saveStatus'),buttons=[...correction.querySelectorAll('button')],sendToClassroom=event.submitter?.name==='sendToClassroom',emailStudent=event.submitter?.name==='emailStudent';
    if(emailStudent && !ungraded && correction.dataset.classroomDraft!=='true')return;
    if(emailStudent && ungraded && !correction.elements.feedback.value.trim()){message.textContent='Enter teacher feedback before sending email.';correction.elements.feedback.focus();return;}
    const fields=[...correction.querySelectorAll('input, textarea')];
    fields.forEach(field=>field.disabled=true);
    buttons.forEach(button=>button.disabled=true);message.textContent=emailStudent?'Sending email…':sendToClassroom?'Saving and sending grade…':ungraded?'Saving feedback…':'Saving corrections…';
    const scores=r.grading.manual.map(q=>{const value=correction.elements.namedItem('manual'+q.index).value;return value===''?null:Number(value);});
    try {
        const response=await fetch(SUBMISSIONS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'correct',pointsRevision:r.grading.pointsRevision || 0,id:r.id,scores,overrides:QuizCorrection.overrides(correction),explanations:QuizCorrection.explanations(correction),emailStudent,sendToClassroom,feedback:correction.elements.feedback.value})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||(ungraded?'Feedback was not saved.':'Corrections were not saved.'));
        correction.dataset.classroomDraft=String(result.grading.classroomDraft===true);
        r.grading=result.grading;renderRoster(currentRoster);renderSummary();document.getElementById('score-'+r.id).textContent=scoreText(r.grading);message.textContent=(ungraded?'Feedback saved. ':emailStudent?'':'Corrections saved. ')+scoreText(r.grading);
        if(result.email)message.textContent+=(ungraded?' Feedback':' Corrected test')+' accepted for email delivery to '+result.email.to+'.';
        if(result.emailError)message.textContent+=' Email not sent: '+result.emailError+(ungraded?' Your feedback is saved; you can retry emailing.':' Your corrections are saved; you can retry emailing.');
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
    }catch(error){message.textContent=error.message+(ungraded?' Your feedback remains in the field.':' Your unsaved corrections remain in the fields.');}
    finally{fields.forEach(field=>field.disabled=false);buttons.forEach(button=>button.disabled=button.name==='emailStudent' && !ungraded && correction.dataset.classroomDraft!=='true');}
});
document.getElementById('export').addEventListener('click',()=>{
    const gradedQuestions=questions.filter(q=>q.type!=='section');
    const columns = gradedQuestions.map((q,i)=>`${i+1}. ${q.extraCredit?'[Extra credit] ':''}${q.prompt}`);
    // Prevent answers or names being interpreted as spreadsheet formulas.
    const csvCell = v => { let s = String(v); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"'+s.replace(/"/g,'""')+'"'; };
    const answerValues=r=>r.answers.flatMap((values,i)=>questions[i].type==='section'?[]:[questions[i].type==='recording'?(values[0]?'Recorded answer (listen in teacher tools)':'(No recording)'):values.join(' | ')]);
    const rows = ungraded?[['Name','School email','Submitted at (Eastern Time)','Receipt','Teacher feedback',...columns],...records.map(r=>[r.name,r.email,formatResultTime(r.submittedAt),r.id,r.grading.feedback,...answerValues(r)])]:[['Name','School email','Submitted at (Eastern Time)','Receipt','Automatic points',...gradedQuestions.flatMap((q,i)=>(q.type==='text'||q.type==='recording'||q.type==='gaps'&&q.wordBank===false)?['Q'+(i+1)+' points']:[]),'Final score','Questions awaiting correction','Teacher feedback',...columns],...records.map(r=>[r.name,r.email,formatResultTime(r.submittedAt),r.id,r.grading.automaticScore,...r.grading.manual.map(q=>q.score??''),r.grading.total??'',r.grading.pending,r.grading.feedback,...answerValues(r)])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'PP-Quiz-submissions.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});

document.getElementById('classChoice').addEventListener('change',()=>{document.getElementById('classLink').hidden=true;});


document.getElementById('reports').addEventListener('toggle',async event=>{
    const card=event.target;
    if(!card.matches('details.card'))return;
    if(!card.open){
        card.querySelectorAll('audio').forEach(audio=>audio.pause());
        return;
    }
    if(!ungraded)return;
    const record=records.find(r=>card.id==='submission-'+r.id);
    if(!record || record.reviewedAt || record.grading.savedAt || record.reviewSaving)return;
    const message=card.querySelector('.reviewStatus');
    record.reviewSaving=true;
    try{
        const response=await fetch(SUBMISSIONS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'review',id:record.id}),signal:AbortSignal.timeout(15000)});
        const result=await response.json();if(!response.ok)throw Error(result.error || 'Viewed status could not be saved.');
        record.reviewedAt=result.reviewedAt;message.textContent='';
    }catch(error){message.textContent='Viewed status could not be saved. Close and reopen this submission to retry.';}
    finally{record.reviewSaving=false;}
},true);

QuizRecording.bindPlayback(document.getElementById('reports'),async(index,reference,id,container)=>{
    const submissionId=id || container.closest('form.correction')?.dataset.id;
    return QuizRecording.loadRecording(async body=>{
        const response=await fetch(SUBMISSIONS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
        const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error || 'The recording could not be loaded.'),{status:response.status});return result;
    },{action:'recording-review',id:submissionId,index});
});

for(const tableId of ['rosterRows','resultsRows'])document.getElementById(tableId).addEventListener('click',event=>{
    const link=event.target.closest('a[data-submission]');
    if(!link)return;
    const submission=document.getElementById('submission-'+link.dataset.submission);
    if(!submission)return;
    event.preventDefault();submission.open=true;
    submission.scrollIntoView({block:'start'});
    submission.querySelector('summary').focus({preventScroll:true});
});

QuizQuestionAudio.bind(document,async record=>{
    const response=await fetch('/api/game-scores?game=quiz-builder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record),signal:AbortSignal.timeout(45000)});
    const result=await response.json();if(!response.ok)throw Error(result.error || 'The teacher recording could not be loaded.');return result;
});
