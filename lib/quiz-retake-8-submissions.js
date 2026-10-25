const crypto = require('crypto');
const { list, put } = require('@vercel/blob');
const { getPage, authenticatePage } = require('./vocabulary-pages');
const questions = require('../Penina-Quizzes/gemara-8-intro-retake/questions.json');
const { grade, validCorrections, validOverrides } = require('./quiz-retake-grading');
const GRADE_PREFIX = 'quiz-corrections/gemara-8-intro-retake/';
const ATTEMPT_PREFIX = 'quiz-attempts/gemara-8-intro-retake/';
const DURATION_MS = 1000 * 60 * 1000;
const PRACTICE_PREFIX = 'quiz-practice/gemara-8-intro-retake/';
const PREFIX = 'quiz-submissions/gemara-8-intro-retake/';
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
function validate(body, expired = false) {
    if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120
        || typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
        || !/^[a-f0-9]{32}$/.test(body.id || '') || !Array.isArray(body.answers) || body.answers.length !== questions.length) return false;
    return questions.every((q,i)=>{
        const values=body.answers[i];
        if(!Array.isArray(values) || !values.every(v=>typeof v==='string' && v.length<=2000))return false;
        if(q.type==='text')return values.length===1 && (expired || Boolean(values[0].trim()));
        if(q.type==='multi')return values.length<=q.choices.length && (expired || values.length>0)
            && new Set(values).size===values.length && values.every(v=>q.choices.includes(v));
        const count=q.type==='gaps'?2:q.choices.length;
        return values.length===count && values.every(v=>q.choices.includes(v) || (expired && v===''))
            && new Set(values.filter(Boolean)).size===values.filter(Boolean).length;
    });
}
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
module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    let body = req.body;
    try {
        if (body?.action === 'report' || body?.action === 'correct') {
            const account = require('./quiz-account');
            const owner = account.isAccountOwner?.(req);
            if(owner && req.headers?.origin!=='https://www.penina-hebrew.org')return res.status(403).json({error:'Open Teacher tools on Penina.'});
            const denied = owner ? null : authenticatePage(await getPage('sixth'), body.password);
            if (denied) return res.status(denied.status).json({ error: denied.error });
            key();
            if (body.action === 'correct') {
                if (!/^[a-f0-9]{32}$/.test(body.id || '') || !validCorrections(body.scores)
                    || typeof body.feedback !== 'string' || body.feedback.length > 2000) {
                    return res.status(400).json({error:'Enter non-negative scores. Scores may exceed the suggested points; half points are allowed.'});
                }
                const records = await readRecords(PREFIX + body.id + '.json');
                const record = records.find(r=>r.id===body.id);
                if (!record) return res.status(404).json({error:'This submission was not found.'});
                if (!validOverrides(body.overrides,grade(record.answers).automatic,body.explanations,grade(record.answers).manual)) return res.status(400).json({error:'Enter non-negative override points using the permitted point increments.'});
                const correction = {id:body.id,scores:body.scores,overrides:body.overrides,explanations:body.explanations,feedback:body.feedback,savedAt:new Date().toISOString()};
                if(body.emailStudent===true && grade(record.answers,correction).pending) return res.status(400).json({error:'Grade every written answer before emailing the corrected test.'});
                const previous=(await readRecords(GRADE_PREFIX + body.id + '/')).sort((a,b)=>b.savedAt.localeCompare(a.savedAt))[0];
                correction.lmsSentAt=previous?.lmsSentAt || null;
                correction.studentSentAt=previous?.studentSentAt || null;
                const signature=c=>JSON.stringify([c.scores,Object.entries(c.overrides || {}).sort(),Object.entries(c.explanations || {}).sort(),c.feedback || '']);
                correction.classroomDraft=previous?.classroomDraft===true && signature(previous)===signature(correction);
                if(body.emailStudent===true && !correction.classroomDraft) return res.status(409).json({error:'Save and send the current grading to Classroom as a draft before sending email.'});
                correction.savedAt=body.emailStudent===true?previous.savedAt:new Date(Math.max(Date.now(),Date.parse(previous?.savedAt || '')+1 || 0)).toISOString();
                if(body.sendToClassroom===true)correction.classroomDraft=false;
                if(body.emailStudent!==true)await put(GRADE_PREFIX + body.id + '/' + crypto.randomUUID() + '.json', encrypt(correction), {
                    access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false
                });
                const grading=grade(record.answers,correction);
                if(body.emailStudent===true) {
                    try {
                        const email=await require('./quiz-correction-email').sendCorrectedTest({record,questions,grading,title:'Gemara 8 · Intro (Retake)'});
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
                        const classroom=await require('./quiz-account').sendGrade(req,record,grading,'gemara-8-intro-retake');
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
            return res.status(200).json({questions,submissions:records.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))
                .map(record=>({...record,grading:grade(record.answers,latest.get(record.id))}))});
        }
        if (!['start','submit'].includes(body?.action)) return res.status(400).json({error:'Choose a quiz action.'});
        const identity=await require('./quiz-account').requireStudent(req,body.classId,'gemara-8-intro-retake');
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
            const attempt = {kind:'attempt',isClassTeacher:Boolean(identity.isClassTeacher),sub:identity.sub,classId:identity.classId,id:body.id,email,startedAt:Date.now(),deadline:Date.now()+DURATION_MS};
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
        if (body?.action === 'submit') {
            try { attempt=decrypt(body.token); } catch (_) { return res.status(400).json({error:'Start the quiz before submitting.'}); }
            if (Boolean(attempt.isClassTeacher)!==Boolean(identity.isClassTeacher) || attempt.sub!==identity.sub || attempt.classId!==identity.classId || attempt.kind!=='attempt' || attempt.id!==body.id || attempt.email!==body.email?.trim().toLowerCase())
                return res.status(400).json({error:'The quiz must be submitted with the school email used to start it.'});
        }
        const expired = attempt && Date.now() >= attempt.deadline;
        if (body?.action !== 'submit' || !validate(body, expired)) return res.status(400).json({ error: 'Enter your name, school email, and an answer to each required question.' });
        key();
        const pathname = (identity.isClassTeacher ? PRACTICE_PREFIX : PREFIX) + body.id + '.json';
        let record = { sub:identity.sub,classId:identity.classId,className:identity.className, startedAt:new Date(attempt.startedAt).toISOString(),deadline:new Date(attempt.deadline).toISOString(),expired, id: body.id, name: body.name.trim(), email: body.email.trim(), answers: body.answers, submittedAt: new Date().toISOString() };
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
        let classroom;
        if(!identity.isClassTeacher) {
            try {classroom=await require('./quiz-account').turnInSubmission(req,record,'gemara-8-intro-retake');}
            catch(error){classroom={turnedIn:false,message:'Your answers are saved in Penina, but Classroom turn-in did not finish. Open Classroom and mark this assignment as done.'};}
        }
        return res.status(200).json({ classroom, accepted: true, receipt: body.id, answers:record.answers, submittedAt:record.submittedAt, automatic:grade(record.answers).automatic.map(q=>({index:q.index,correct:q.score===q.max})) });
    } catch (error) {
        console.error('Quiz request failed:', error.message);
        return res.status(error.status || 503).json({ error: error.status ? error.message : 'The quiz could not be saved or loaded. Your answers are still available on this page. Please try again.' });
    }
};
module.exports.encrypt = encrypt;
module.exports.decrypt = decrypt;
module.exports.validate = validate;
