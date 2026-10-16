const crypto = require('crypto');
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function correctedTest({record,questions,grading,title}) {
    if(grading.pending || grading.total === null) throw new Error('Finish correcting every question first.');
    const text=[title,record.name,`Final score: ${grading.total}/${grading.baseMax}`,''];
    const cards=questions.map((q,index)=>{
        const grade=[...grading.automatic,...grading.manual].find(item=>item.index===index);
        const result=grade.score===grade.max?'Correct':grade.score===0?'Incorrect':'Partial credit';
        const color=grade.score===grade.max?'#17613b':grade.score===0?'#a12b34':'#805000';
        const answers=record.answers[index].map((answer,i)=>(q.fields?.[i]?q.fields[i]+': ':'')+(answer || '(No answer)')).join('\n');
        const override=grade.overridden?`Teacher override: ${grade.originalScore}/${grade.max} → ${grade.score}/${grade.max}`:'';
        text.push(`Question ${index+1}${q.extraCredit?' · Extra credit':''}: ${q.prompt}`,`Your answer: ${answers}`,`${result} · ${grade.score}/${grade.max} points`,override,grade.explanation?`Teacher explanation: ${grade.explanation}`:'','');
        return `<section style="background:${q.extraCredit?'#fff9ea':'#ffffff'};border:1px solid #d5dde2;border-top:4px solid ${color};border-radius:10px;padding:20px;margin:24px 0"><p style="color:${color};font-weight:bold">Question ${index+1}${q.extraCredit?' · Extra credit':''} · ${result} · ${grade.score}/${grade.max} points</p><h2 dir="auto" style="font-size:20px;white-space:pre-wrap">${esc(q.prompt)}</h2><p><strong>Your answer</strong></p><p dir="auto" style="white-space:pre-wrap">${esc(answers)}</p>${override?`<p style="font-weight:bold">${esc(override)}</p>`:''}${grade.explanation?`<div style="background:#eef5ff;padding:16px"><strong>Teacher explanation</strong><p dir="auto" style="white-space:pre-wrap">${esc(grade.explanation)}</p></div>`:''}</section>`;
    }).join('');
    if(grading.feedback)text.push('Teacher feedback:',grading.feedback);
    const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:17px/1.65 Arial,sans-serif;color:#20343c"><main style="max-width:720px;margin:auto;padding:20px"><h1>${esc(title)}</h1><p>${esc(record.name)}</p><p><strong>Final score: ${grading.total}/${grading.baseMax}</strong></p>${cards}${grading.feedback?`<h2>Teacher feedback</h2><p dir="auto" style="white-space:pre-wrap">${esc(grading.feedback)}</p>`:''}</main></body></html>`;
    return {subject:'Corrected Assessment: '+title,text:text.filter(v=>v!==undefined).join('\n'),html};
}
async function sendCorrectedTest(data) {
    const from=process.env.QUIZ_EMAIL_FROM || process.env.LIVE_SCORE_EMAIL_FROM;
    if(!process.env.RESEND_API_KEY || !from)throw new Error('Email service is not configured.');
    // The recipient comes only from the saved, authenticated student submission.
    const to=data.record.email;
    if(typeof to!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw new Error('The saved student email is invalid.');
    const payload={from,to:[to],...correctedTest(data)};
    const idempotency=crypto.createHash('sha256').update(data.record.id+JSON.stringify(payload)).digest('hex');
    let response;
    try { response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'quiz-correction-'+idempotency},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)}); }
    catch {throw new Error('The email service could not be reached. Retry sending.');}
    if(!response.ok)throw new Error('The email service did not accept the message. Retry sending.');
    return {status:'accepted',to};
}
module.exports={correctedTest,sendCorrectedTest};
