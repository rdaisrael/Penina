const crypto = require('crypto');
const { list, put } = require('@vercel/blob');
function createHandler(quiz) {
const model=require('./quiz-builder-model');
const validOverrides=model.validOverrides;
const questions=quiz.questions;
const grade=(answers,correction)=>model.grade(quiz,answers,correction);
const validCorrections=scores=>model.validCorrections(quiz,scores);
const GRADE_PREFIX = 'quiz-corrections/'+quiz.id+'/';
const ATTEMPT_PREFIX = 'quiz-attempts/'+quiz.id+'/';
const DURATION_MS = quiz.durationMinutes===null?null:quiz.durationMinutes * 60 * 1000;
const LOCK_PREFIX = "quiz-progress/"+quiz.id+"/";
const PRACTICE_PREFIX = 'quiz-practice/'+quiz.id+'/';
const PREFIX = 'quiz-submissions/'+quiz.id+'/';
function key() {
    const secret = process.env.QUIZ_STORAGE_SECRET || process.env.VOCABULARY_PAGE_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret || !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Quiz storage is not configured.');
    return crypto.createHash('sha256').update('penina-quiz-v1:' + secret).digest();
}
function encrypt(record) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(PREFIX));
    const data = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function decrypt(raw) {
    const item = JSON.parse(raw);
    if (item.v !== 1) throw new Error('Unsupported quiz record.');
    const cipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(item.iv, 'base64'));
    cipher.setAAD(Buffer.from(PREFIX)); cipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(item.data, 'base64')), cipher.final()]).toString('utf8'));
}
function validate(body,expired=false) {return /^[a-f0-9]{32}$/.test(body.id || '') && model.validAnswers(quiz,body.answers,expired);}
async function readRecords(prefix) {
    let cursor; const records = [];
    do {
        const result = await list({ prefix, cursor, limit: 1000 });
        for (let i = 0; i < result.blobs.length; i += 20) {
            records.push(...await Promise.all(result.blobs.slice(i, i + 20).map(async blob => {
                const response = await fetch(blob.url, { cache: 'no-store' });
                if (!response.ok) throw new Error('A quiz record could not be read.');
                return decrypt(await response.text());
            })));
        }
        cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return records;
}
function fail(status,message){const error=new Error(message);error.status=status;throw error;}
function progressPath(attempt){return LOCK_PREFIX+crypto.createHmac('sha256',key()).update(attempt.sub+':'+attempt.classId+':'+attempt.id).digest('hex')+'/';}
async function progress(attempt) {
    const from=quiz.forwardOnlyFrom ?? null;
    if(from===null)return {lockedThrough:-1,lockedAnswers:[],forwardOnly:false};
    const steps=(await readRecords(progressPath(attempt))).sort((a,b)=>a.through-b.through);
    const lockedAnswers=[];let next=from-1;
    for(const step of steps){
        if(step.through!==next || step.from!==lockedAnswers.length)fail(503,'Quiz progress could not be restored. Try again.');
        lockedAnswers.push(...step.answers);next=step.through+1;
    }
    return {lockedThrough:lockedAnswers.length-1,lockedAnswers,forwardOnly:lockedAnswers.length>=from};
}
return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    let body = req.body;
    try {
        if (body?.action === 'report' || body?.action === 'correct') {
            if(req.headers?.origin!=='https://www.penina-hebrew.org')return res.status(403).json({error:'Open teacher tools on Penina.'});
            const teacher=require('./quiz-builder').owner(req);
            if(teacher.sub!==quiz.owner)return res.status(403).json({error:'Only the author can review this quiz.'});
            key();
            if (body.action === 'correct') {
                if((body.pointsRevision || 0)!==(quiz.pointsRevision || 0))return res.status(409).json({error:'Potential points changed. Reload roster and results before saving or sending grades.'});
                if (!/^[a-f0-9]{32}$/.test(body.id || '') || !validCorrections(body.scores)
                    || typeof body.feedback !== 'string' || body.feedback.length > 2000) {
                    return res.status(400).json({error:'Enter non-negative scores. Scores may exceed the suggested points; use the permitted point increments. Half points are allowed only when Allow half credit is enabled for that question.'});
                }
                const records = await readRecords(PREFIX + body.id + '.json');
                const record = records.find(r=>r.id===body.id);
                if (!record) return res.status(404).json({error:'This submission was not found.'});
                if (!validOverrides(body.overrides,grade(record.answers).automatic,body.explanations,grade(record.answers).manual)) return res.status(400).json({error:'Enter non-negative override points using the permitted point increments.'});
                const correction = {pointsRevision:quiz.pointsRevision || 0,id:body.id,scores:body.scores,overrides:body.overrides,explanations:body.explanations,feedback:body.feedback,savedAt:new Date().toISOString()};
                if(body.emailStudent===true && grade(record.answers,correction).pending) return res.status(400).json({error:'Grade every written answer before emailing the corrected test.'});
                const previous=(await readRecords(GRADE_PREFIX + body.id + '/')).sort((a,b)=>b.savedAt.localeCompare(a.savedAt))[0];
                const samePoints=(previous?.pointsRevision || 0)===(quiz.pointsRevision || 0);
                correction.lmsSentAt=samePoints?previous?.lmsSentAt || null:null;
                correction.studentSentAt=samePoints?previous?.studentSentAt || null:null;
                const signature=c=>JSON.stringify([c.scores,Object.entries(c.overrides || {}).sort(),Object.entries(c.explanations || {}).sort(),c.feedback || '']);
                correction.classroomDraft=samePoints && previous?.classroomDraft===true && signature(previous)===signature(correction);
                if(body.emailStudent===true && !correction.classroomDraft) return res.status(409).json({error:'Save and send the current grading to Classroom as a draft before sending email.'});
                correction.savedAt=body.emailStudent===true?previous.savedAt:new Date(Math.max(Date.now(),Date.parse(previous?.savedAt || '')+1 || 0)).toISOString();
                if(body.sendToClassroom===true)correction.classroomDraft=false;
                if(body.emailStudent!==true)await put(GRADE_PREFIX + body.id + '/' + crypto.randomUUID() + '.json', encrypt(correction), {
                    access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false
                });
                const grading=grade(record.answers,correction);
                if(body.emailStudent===true) {
                    try {
                        const email=await require('./quiz-correction-email').sendCorrectedTest({record,questions,grading,title:quiz.title});
                        correction.studentSentAt=new Date().toISOString();
                        correction.savedAt=new Date(Math.max(Date.now(),Date.parse(correction.savedAt)+1)).toISOString();
                        await put(GRADE_PREFIX + body.id + '/' + crypto.randomUUID() + '.json', encrypt(correction), {
                            access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false
                        });
                        return res.status(200).json({grading:grade(record.answers,correction),email});
                    } catch(error) {
                        return res.status(200).json({grading,emailError:error.message});
                    }
                }
                if(body.sendToClassroom===true) {
                    try {
                        const classroom=await require('./quiz-account').sendGrade(req,record,grading,quiz.id);
                        correction.classroomDraft=true;
                        correction.lmsSentAt=classroom.sentAt || new Date().toISOString();
                        correction.savedAt=new Date(Math.max(Date.now(),Date.parse(correction.savedAt)+1)).toISOString();
                        await put(GRADE_PREFIX + body.id + '/' + crypto.randomUUID() + '.json', encrypt(correction), {
                            access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false
                        });
                        return res.status(200).json({grading:grade(record.answers,correction),classroom});
                    } catch(error) {
                        // Corrections remain saved even when Google is unavailable; retry sends the same grade.
                        return res.status(200).json({grading,classroomError:error.status?error.message:'The grade could not be sent to Classroom. Try again.'});
                    }
                }
                return res.status(200).json({grading});
            }
            const [records,corrections] = await Promise.all([readRecords(PREFIX),readRecords(GRADE_PREFIX)]);
            const latest = new Map();
            for (const correction of corrections) {
                if (!latest.has(correction.id) || latest.get(correction.id).savedAt < correction.savedAt) latest.set(correction.id,correction);
            }
            const roster=body.courseId?await require('./quiz-account').classRoster(req,body.courseId,quiz.id):null;
            const submissions=records.filter(r=>!roster || r.classId===roster.classId).sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))
                .map(record=>({...record,grading:grade(record.answers,latest.get(record.id))}));
            const attempts=roster?await readRecords(ATTEMPT_PREFIX):[];
            return res.status(200).json({title:quiz.title,questions,submissions,summary:model.summarize(quiz,submissions),
                roster:roster?{...roster,students:model.rosterStatuses(roster,submissions,attempts)}:null});
        }
        if (!['start','submit','state','advance'].includes(body?.action)) return res.status(400).json({error:'Choose a quiz action.'});
        const identity=await require('./quiz-account').requireStudent(req,body.classId,quiz.id);
        body={...body,name:identity.name,email:identity.email};
        if (body?.action === 'start') {
            if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
                || !/^[a-f0-9]{32}$/.test(body.id || '')) return res.status(400).json({error:'Enter your school email.'});
            key();
            const email = body.email.trim().toLowerCase();
            const pathname = ATTEMPT_PREFIX + crypto.createHmac('sha256',key()).update(identity.sub+':'+identity.classId+(identity.isClassTeacher?':practice:'+body.id:'')).digest('hex') + '.json';
            // Existing quizzes submitted before timed attempts were introduced also count.
            const previous = !identity.isClassTeacher && (await readRecords(PREFIX)).find(record=>record.sub===identity.sub && record.classId===identity.classId);
            if (previous) return res.status(409).json({error:'This school email has already submitted this quiz. Only one submission is allowed.'});
            const attempt = {kind:'attempt',isClassTeacher:Boolean(identity.isClassTeacher),sub:identity.sub,classId:identity.classId,id:body.id,email,startedAt:Date.now(),deadline:DURATION_MS===null?null:Date.now()+DURATION_MS};
            let token = encrypt(attempt);
            try {
                await put(pathname,token,{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});
            } catch(error) {
                const existing = await readRecords(pathname);
                if (!existing.length) throw error;
                token = encrypt(existing[0]);
            }
            const restored = decrypt(token);
            return res.status(200).json({token,id:restored.id,deadline:restored.deadline});
        }
        let attempt;
        if (['submit','state','advance'].includes(body?.action)) {
            try { attempt=decrypt(body.token); } catch (_) { return res.status(400).json({error:'Start the quiz before submitting.'}); }
            if (Boolean(attempt.isClassTeacher)!==Boolean(identity.isClassTeacher) || attempt.sub!==identity.sub || attempt.classId!==identity.classId || attempt.kind!=='attempt' || attempt.id!==body.id || attempt.email!==body.email?.trim().toLowerCase())
                return res.status(400).json({error:'The quiz must be submitted with the school email used to start it.'});
        }
        const expired = attempt.deadline!==null && Date.now()>=attempt.deadline;
        const state=await progress(attempt);
        if(body.action==='state')return res.status(200).json({...state,deadline:attempt.deadline});
        if(body.action==='advance') {
            if(expired)fail(409,'Time has expired. Submit your saved answers.');
            if(quiz.forwardOnlyFrom==null)fail(400,'This quiz has no forward-only checkpoint.');
            if(!Number.isInteger(body.through) || body.through<quiz.forwardOnlyFrom-1 || body.through>=questions.length)fail(400,'Choose the next quiz step.');
            if(body.through<=state.lockedThrough)return res.status(200).json(state);
            const expected=state.forwardOnly?state.lockedThrough+1:quiz.forwardOnlyFrom-1;
            if(body.through!==expected)fail(409,'Continue from the current question. Reload to restore saved progress.');
            if(!Array.isArray(body.answers))fail(400,'Complete the answers before continuing.');
            const canonical=[...state.lockedAnswers,...body.answers.slice(state.lockedAnswers.length,body.through+1)];
            if(!model.validAnswers({questions:questions.slice(0,body.through+1)},canonical))fail(400,'Complete each answer before locking it and continuing.');
            const pathname=progressPath(attempt)+body.through+'.json';
            const step={from:state.lockedAnswers.length,through:body.through,answers:canonical.slice(state.lockedAnswers.length)};
            try{await put(pathname,encrypt(step),{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});}
            catch(error){if(!(await readRecords(pathname)).length)throw error;}
            return res.status(200).json(await progress(attempt));
        }
        if(!expired && quiz.forwardOnlyFrom!=null && state.lockedThrough!==questions.length-1)fail(409,'Continue through the review checkpoint and all remaining questions before submitting.');
        // Server-held answers take precedence over stale tabs or modified browser values.
        if(Array.isArray(body.answers))body.answers=body.answers.map((answer,i)=>i<=state.lockedThrough?state.lockedAnswers[i]:answer);
        if (body?.action !== 'submit' || !validate(body, expired)) return res.status(400).json({ error: 'Complete each required question before submitting.' });
        key();
        const pathname = (identity.isClassTeacher ? PRACTICE_PREFIX : PREFIX) + body.id + '.json';
        let record = { sub:identity.sub,classId:identity.classId,className:identity.className, startedAt:new Date(attempt.startedAt).toISOString(),deadline:attempt.deadline===null?null:new Date(attempt.deadline).toISOString(),expired, id: body.id, name: body.name.trim(), email: body.email.trim(), answers: body.answers, submittedAt: new Date().toISOString() };
        try {
            await put(pathname, encrypt(record), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false });
        } catch (error) {
            // A retry after a lost response must not overwrite or duplicate an accepted submission.
            const existing = await list({ prefix: pathname, limit: 1 });
            if (!existing.blobs.some(blob => blob.pathname === pathname)) throw error;
            record = (await readRecords(pathname)).find(r=>r.id===body.id);
            if (!record) throw error;
            if(record.sub!==identity.sub || record.classId!==identity.classId) return res.status(403).json({error:'This receipt belongs to another student or class.'});
        }
        return res.status(200).json({ accepted: true, receipt: body.id, answers:record.answers, submittedAt:record.submittedAt, automatic:require('../Penina-Quizzes/custom/scoring').feedback(questions,record.answers,true) });
    } catch (error) {
        console.error('Quiz request failed:', error.message);
        return res.status(error.status || 503).json({ error: error.status ? error.message : 'The quiz could not be saved or loaded. Your answers are still available on this page. Please try again.' });
    }
};
}
module.exports=async function(req,res){
    try {const quiz=await require('./quiz-builder').published(req.query?.quiz || req.body?.quiz);return await createHandler(quiz)(req,res);}
    catch(error){res.setHeader('Cache-Control','no-store');return res.status(error.status || 503).json({error:error.status?error.message:'The quiz could not be loaded. Try again.'});}
};
module.exports.createHandler=createHandler;
