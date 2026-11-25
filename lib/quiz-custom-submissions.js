const crypto = require('crypto');
const { list, put, del } = require('@vercel/blob');
const {createStorage,requestContext,failureDetails}=require('./quiz-submission-storage');
function createHandler(quiz) {
const model=require('./quiz-builder-model');
const validOverrides=model.validOverrides;
const questions=quiz.questions;
const grade=(answers,correction)=>model.grade(quiz,answers,correction);
const validCorrections=scores=>model.validCorrections(quiz,scores);
const GRADE_PREFIX = 'quiz-corrections/'+quiz.id+'/';
const REVIEW_PREFIX = 'quiz-reviews/'+quiz.id+'/';
const ATTEMPT_PREFIX = 'quiz-attempts/'+quiz.id+'/';
const DURATION_MS = quiz.durationMinutes===null?null:quiz.durationMinutes * 60 * 1000;
const LOCK_PREFIX = "quiz-progress/"+quiz.id+"/";
const PRACTICE_PREFIX = 'quiz-practice/'+quiz.id+'/';
const PREFIX = 'quiz-submissions/'+quiz.id+'/';
const AUDIO_PREFIX = 'quiz-recordings/'+quiz.id+'/';
const {key,encrypt,decrypt,readRecords}=createStorage(quiz.id);
function validate(body,expired=false) {return /^[a-f0-9]{32}$/.test(body.id || '') && model.validAnswers(quiz,body.answers,expired);}
function fail(status,message){const error=new Error(message);error.status=status;throw error;}
function recordingPath(attempt,index,reference){
    if(!Number.isInteger(index) || questions[index]?.type!=='recording' || typeof reference!=='string' || !/^recording:[a-f0-9]{32}$/.test(reference))fail(400,'Choose a recorded answer.');
    return AUDIO_PREFIX+crypto.createHmac('sha256',key()).update(JSON.stringify([attempt.sub,attempt.classId,attempt.id,index,reference])).digest('hex')+'.json';
}
const recordingPartsPath=pathname=>pathname.slice(0,-5)+'-parts/';
async function writeRecording(pathname,recording,context){
    try{await put(pathname,encrypt(recording),{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});}
    catch(error){
        const previous=(await readRecords(pathname,context))[0];
        if(!previous || JSON.stringify(previous)!==JSON.stringify(recording))throw error;
    }
}
async function readRecording(attempt,index,reference,context,part){
    const pathname=recordingPath(attempt,index,reference);
    await require('./quiz-recording-retention').assertAvailable(pathname);
    const recording=(await readRecords(pathname,context))[0];
    if(!recording)fail(400,'This recording has not been saved. Return to the question and retry saving the recording.');
    if(part!==undefined){
        if(!recording.chunked || !Number.isInteger(part) || part<0 || part>=recording.totalParts)fail(400,'Choose a valid recording part.');
        const piece=(await readRecords(recordingPartsPath(pathname)+part+'.json',context))[0];
        if(!piece)fail(503,'This recording part could not be loaded. Try again.');
        return piece;
    }
    return recording;
}
async function verifyRecordings(attempt,answers,from=0){
    // Uploads are immutable and validated before storage. Verify exact scoped
    // paths without downloading every student's audio again at each checkpoint.
    const paths=answers.flatMap((answer,i)=>i>=from && questions[i].type==='recording' && answer[0]?[recordingPath(attempt,i,answer[0])]:[]);
    for(let i=0;i<paths.length;i+=10)await Promise.all(paths.slice(i,i+10).map(async pathname=>{
        await require('./quiz-recording-retention').assertAvailable(pathname);
        let result;try{result=await list({prefix:pathname,limit:1});}catch(error){error.operation='list-recordings';throw error;}
        if(!result.blobs.some(blob=>blob.pathname===pathname))fail(400,'A recording has not been saved. Retry saving it before continuing.');
    }));
}
function progressPath(attempt){return LOCK_PREFIX+crypto.createHmac('sha256',key()).update(attempt.sub+':'+attempt.classId+':'+attempt.id).digest('hex')+'/';}
async function progress(attempt, context) {
    const from=quiz.forwardOnlyFrom ?? null;
    if(from===null)return {lockedThrough:-1,lockedAnswers:[],forwardOnly:false};
    const steps=(await readRecords(progressPath(attempt), context)).sort((a,b)=>a.through-b.through);
    const lockedAnswers=[];let next=from-1;
    for(const step of steps){
        if(step.through!==next || step.from!==lockedAnswers.length)fail(503,'Quiz progress could not be restored. Try again.');
        lockedAnswers.push(...step.answers);next=step.through+1;
    }
    return {lockedThrough:lockedAnswers.length-1,lockedAnswers,forwardOnly:lockedAnswers.length>=from};
}
return async function handler(req, res, context = requestContext(req, quiz.id)) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    let body = req.body;
    try {
        if(['recordings-delete-preview','recordings-delete'].includes(body?.action)){
            if(req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open teacher tools on Penina.');
            const teacher=require('./quiz-builder').owner(req);
            if(teacher.sub!==quiz.owner)fail(403,'Only the quiz author can delete its recordings.');
            return res.status(200).json(await require('./quiz-recording-retention').manual(quiz,teacher,body));
        }
        if(['recording-save','recording-load','recording-review'].includes(body?.action) && req.headers?.origin!=='https://www.penina-hebrew.org')fail(403,'Open the quiz on Penina.');
        if(body?.action==='recording-review'){
            const teacher=require('./quiz-builder').owner(req);
            if(teacher.sub!==quiz.owner)fail(403,'Only the author can review this quiz.');
            if(!/^[a-f0-9]{32}$/.test(body.id || ''))fail(400,'Choose a submission.');
            const record=(await readRecords(PREFIX+body.id+'.json',context)).find(r=>r.id===body.id);
            if(!record)fail(404,'This submission was not found.');
            const recording=await readRecording(record,body.index,record.answers[body.index]?.[0],context,body.part);
            return res.status(200).json(recording);
        }
        if (['report','correct','review'].includes(body?.action)) {
            if(req.headers?.origin!=='https://www.penina-hebrew.org')return res.status(403).json({error:'Open teacher tools on Penina.'});
            const teacher=require('./quiz-builder').owner(req);
            if(teacher.sub!==quiz.owner)return res.status(403).json({error:'Only the author can review this quiz.'});
            key();
            if(body.action==='review') {
                if(quiz.gradingMode!=='ungraded')fail(400,'Save corrections to complete a graded quiz.');
                if(!/^[a-f0-9]{32}$/.test(body.id || ''))fail(400,'Choose a submission.');
                const record=(await readRecords(PREFIX+body.id+'.json',context)).find(r=>r.id===body.id);
                if(!record)fail(404,'This submission was not found.');
                const review={id:record.id,reviewedAt:new Date().toISOString()};
                await put(REVIEW_PREFIX+record.id+'.json',encrypt(review),{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:true});
                return res.status(200).json(review);
            }
            if (body.action === 'correct') {
                const ungraded=quiz.gradingMode==='ungraded';
                if(ungraded && body.sendToClassroom===true)return res.status(400).json({error:'This quiz is not graded. Grade transfer is unavailable.'});
                if((body.pointsRevision || 0)!==(quiz.pointsRevision || 0))return res.status(409).json({error:'Potential points changed. Reload roster and results before saving or sending grades.'});
                if (!/^[a-f0-9]{32}$/.test(body.id || '') || !validCorrections(body.scores)
                    || typeof body.feedback !== 'string' || body.feedback.length > 2000) {
                    return res.status(400).json({error:'Enter non-negative scores. Scores may exceed the suggested points; use the permitted point increments. Half points are allowed only when Allow half credit is enabled for that question.'});
                }
                if(ungraded && body.emailStudent===true && !body.feedback.trim())return res.status(400).json({error:'Enter teacher feedback before sending email.'});
                const records = await readRecords(PREFIX + body.id + '.json', context);
                const record = records.find(r=>r.id===body.id);
                if (!record) return res.status(404).json({error:'This submission was not found.'});
                if (!validOverrides(body.overrides,grade(record.answers).automatic,body.explanations,grade(record.answers).manual)) return res.status(400).json({error:'Enter non-negative override points using the permitted point increments.'});
                const correction = {pointsRevision:quiz.pointsRevision || 0,id:body.id,scores:body.scores,overrides:body.overrides,explanations:body.explanations,feedback:body.feedback,savedAt:new Date().toISOString()};
                if(body.emailStudent===true && grade(record.answers,correction).pending) return res.status(400).json({error:'Grade every written and recorded answer before emailing the corrected test.'});
                const previous=(await readRecords(GRADE_PREFIX + body.id + '/', context)).sort((a,b)=>b.savedAt.localeCompare(a.savedAt))[0];
                const samePoints=(previous?.pointsRevision || 0)===(quiz.pointsRevision || 0);
                correction.lmsSentAt=samePoints?previous?.lmsSentAt || null:null;
                correction.studentSentAt=samePoints && (!ungraded || previous?.feedback===correction.feedback)?previous?.studentSentAt || null:null;
                const signature=c=>JSON.stringify([c.scores,Object.entries(c.overrides || {}).sort(),Object.entries(c.explanations || {}).sort(),c.feedback || '']);
                correction.classroomDraft=samePoints && previous?.classroomDraft===true && signature(previous)===signature(correction);
                if(!ungraded && body.emailStudent===true && !correction.classroomDraft) return res.status(409).json({error:'Save and send the current grading to Classroom as a draft before sending email.'});
                correction.savedAt=body.emailStudent===true && !ungraded?previous.savedAt:new Date(Math.max(Date.now(),Date.parse(previous?.savedAt || '')+1 || 0)).toISOString();
                if(body.sendToClassroom===true)correction.classroomDraft=false;
                // Save ungraded feedback before attempting delivery so a failed email can be retried after reloading.
                if(body.emailStudent!==true || ungraded)await put(GRADE_PREFIX + body.id + '/' + crypto.randomUUID() + '.json', encrypt(correction), {
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
            const [records,corrections,reviews] = await Promise.all([readRecords(PREFIX, context),readRecords(GRADE_PREFIX, context),quiz.gradingMode==='ungraded'?readRecords(REVIEW_PREFIX,context):[]]);
            const reviewed=new Map(reviews.map(review=>[review.id,review.reviewedAt]));
            const latest = new Map();
            for (const correction of corrections) {
                if (!latest.has(correction.id) || latest.get(correction.id).savedAt < correction.savedAt) latest.set(correction.id,correction);
            }
            const roster=body.courseId?await require('./quiz-account').classRoster(req,body.courseId,quiz.id):null;
            const deletedHashes=questions.some(q=>q.type==='recording')?await require('./quiz-recording-retention').deletedHashes(quiz.id):new Set();
            const submissions=records.filter(r=>!roster || r.classId===roster.classId).sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))
                .map(record=>({...record,deletedRecordings:questions.flatMap((q,i)=>q.type==='recording' && record.answers[i]?.[0] && deletedHashes.has(recordingPath(record,i,record.answers[i][0]).slice(AUDIO_PREFIX.length,-5))?[i]:[]),reviewedAt:reviewed.get(record.id) || (quiz.gradingMode==='ungraded'?latest.get(record.id)?.savedAt:null) || null,grading:grade(record.answers,latest.get(record.id))}));
            const attempts=roster?await readRecords(ATTEMPT_PREFIX, context):[];
            return res.status(200).json({title:quiz.title,gradingMode:quiz.gradingMode || 'graded',questions,submissions,summary:model.summarize(quiz,submissions),
                roster:roster?{...roster,students:model.rosterStatuses(roster,submissions,attempts)}:null});
        }
        if (!['start','submit','state','advance','recording-save','recording-load'].includes(body?.action)) return res.status(400).json({error:'Choose a quiz action.'});
        const identity=await require('./quiz-account').requireStudent(req,body.classId,quiz.id);
        body={...body,name:identity.name,email:identity.email};
        if (body?.action === 'start') {
            if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
                || !/^[a-f0-9]{32}$/.test(body.id || '')) return res.status(400).json({error:'Enter your school email.'});
            key();
            const email = body.email.trim().toLowerCase();
            const pathname = ATTEMPT_PREFIX + crypto.createHmac('sha256',key()).update(identity.sub+':'+identity.classId+(identity.isClassTeacher?':practice:'+body.id:'')).digest('hex') + '.json';
            // Existing quizzes submitted before timed attempts were introduced also count.
            const previous = !identity.isClassTeacher && (await readRecords(PREFIX, context)).find(record=>record.sub===identity.sub && record.classId===identity.classId);
            if (previous) return res.status(409).json({error:'This school email has already submitted this quiz. Only one submission is allowed.'});
            const attempt = {kind:'attempt',isClassTeacher:Boolean(identity.isClassTeacher),sub:identity.sub,classId:identity.classId,id:body.id,email,startedAt:Date.now(),deadline:DURATION_MS===null?null:Date.now()+DURATION_MS};
            let token = encrypt(attempt);
            try {
                await put(pathname,token,{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});
            } catch(error) {
                const existing = await readRecords(pathname, context);
                if (!existing.length) throw error;
                token = encrypt(existing[0]);
            }
            const restored = decrypt(token);
            return res.status(200).json({token,id:restored.id,deadline:restored.deadline});
        }
        let attempt;
        if (['submit','state','advance','recording-save','recording-load'].includes(body?.action)) {
            try { attempt=decrypt(body.token); } catch (_) { return res.status(400).json({error:'Start the quiz before submitting.'}); }
            if (Boolean(attempt.isClassTeacher)!==Boolean(identity.isClassTeacher) || attempt.sub!==identity.sub || attempt.classId!==identity.classId || attempt.kind!=='attempt' || attempt.id!==body.id || attempt.email!==body.email?.trim().toLowerCase())
                return res.status(400).json({error:'The quiz must be submitted with the school email used to start it.'});
        }
        const expired = attempt.deadline!==null && Date.now()>=attempt.deadline;
        const state=await progress(attempt, context);
        if(body.action==='recording-load')return res.status(200).json(await readRecording(attempt,body.index,body.reference,context,body.part));
        if(body.action==='recording-save'){
            const pathname=recordingPath(attempt,body.index,body.reference);
            const retention=require('./quiz-recording-retention');
            await retention.assertAvailable(pathname);
            if(body.index<=state.lockedThrough)fail(409,'This answer is already locked.');
            if((await readRecords((identity.isClassTeacher?PRACTICE_PREFIX:PREFIX)+attempt.id+'.json',context)).length)fail(409,'This quiz has already been submitted.');
            const media=require('./quiz-recording'),question=questions[body.index];
            let recording=media.validateRecording(body,question);
            if(recording.part!==undefined){
                const partsPath=recordingPartsPath(pathname);
                await writeRecording(partsPath+recording.part+'.json',recording,context);
                if(await retention.isDeleted(pathname)){await del(partsPath+recording.part+'.json');await retention.assertAvailable(pathname);}
                if(recording.part<recording.totalParts-1)return res.status(200).json({partSaved:true,part:recording.part});
                recording=media.completeRecording(await readRecords(partsPath,context),recording,question);
            }
            await writeRecording(pathname,recording,context);
            if(await retention.isDeleted(pathname)){await del(pathname);await retention.assertAvailable(pathname);}
            return res.status(200).json({saved:true,reference:body.reference});
        }
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
            await verifyRecordings(attempt,canonical,state.lockedThrough+1);
            const pathname=progressPath(attempt)+body.through+'.json';
            const step={from:state.lockedAnswers.length,through:body.through,answers:canonical.slice(state.lockedAnswers.length)};
            try{await put(pathname,encrypt(step),{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});}
            catch(error){if(!(await readRecords(pathname, context)).length)throw error;}
            return res.status(200).json(await progress(attempt, context));
        }
        if(!expired && quiz.forwardOnlyFrom!=null && state.lockedThrough!==questions.length-1)fail(409,'Continue through the review checkpoint and all remaining questions before submitting.');
        // Server-held answers take precedence over stale tabs or modified browser values.
        if(Array.isArray(body.answers))body.answers=body.answers.map((answer,i)=>i<=state.lockedThrough?state.lockedAnswers[i]:answer);
        if (body?.action !== 'submit' || !validate(body, expired)) return res.status(400).json({ error: 'Complete each required question before submitting.' });
        await verifyRecordings(attempt,body.answers);
        key();
        const pathname = (identity.isClassTeacher ? PRACTICE_PREFIX : PREFIX) + body.id + '.json';
        let record = { sub:identity.sub,classId:identity.classId,className:identity.className, startedAt:new Date(attempt.startedAt).toISOString(),deadline:attempt.deadline===null?null:new Date(attempt.deadline).toISOString(),expired, id: body.id, name: body.name.trim(), email: body.email.trim(), answers: body.answers, submittedAt: new Date().toISOString() };
        try {
            await put(pathname, encrypt(record), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false });
        } catch (error) {
            // A retry after a lost response must not overwrite or duplicate an accepted submission.
            let existing;
            try { existing = await list({ prefix: pathname, limit: 1 }); }
            catch (error) { error.operation = 'list-submission'; throw error; }
            if (!existing.blobs.some(blob => blob.pathname === pathname)) throw error;
            record = (await readRecords(pathname, context)).find(r=>r.id===body.id);
            if (!record) throw error;
            if(record.sub!==identity.sub || record.classId!==identity.classId) return res.status(403).json({error:'This receipt belongs to another student or class.'});
        }
        let classroom;
        if(!identity.isClassTeacher) {
            try {classroom=await require('./quiz-account').turnInSubmission(req,record,quiz.id);}
            catch(error){classroom={turnedIn:false,message:'Your answers are saved in Penina, but Classroom turn-in did not finish. Open Classroom and mark this assignment as done.'};}
        }
        return res.status(200).json({ classroom, accepted: true, receipt: body.id, answers:record.answers, submittedAt:record.submittedAt, automatic:require('../Penina-Quizzes/custom/scoring').feedback(questions,record.answers,true,quiz.gradingMode) });
    } catch (error) {
        console.error('Quiz request failed:', failureDetails(error, context, 'quiz-' + context.action));
        return res.status(error.status || 503).json({ error: error.status ? error.message : 'The quiz could not be saved or loaded. Your answers are still available on this page. Please try again.' });
    }
};
}
module.exports=async function(req,res){
    const context = requestContext(req, req.query?.quiz || req.body?.quiz);
    try {const quiz=await require('./quiz-builder').published(req.query?.quiz || req.body?.quiz);return await createHandler(quiz)(req,res,context);}
    catch(error){console.error('Quiz request failed:', failureDetails(error, context, 'load-published-quiz'));res.setHeader('Cache-Control','no-store');return res.status(error.status || 503).json({error:error.status?error.message:'The quiz could not be loaded. Try again.'});}
};
module.exports.createHandler=createHandler;
