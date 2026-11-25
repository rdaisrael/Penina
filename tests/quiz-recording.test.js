const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../lib/quiz-builder-model'),scoring=require('../Penina-Quizzes/custom/scoring');
const {validateRecording,completeRecording,UPLOAD_BYTES}=require('../lib/quiz-recording');
const question={type:'recording',prompt:'Read the passage and explain the picture.',content:'בְּרֵאשִׁית\nA second line <script>',answer:'Private rubric',points:3,allowHalfCredit:true,direction:'rtl',image:{src:'data:image/png;base64,iVBORw0KGgo=',alt:'A picture',marker:null}};
const reference='recording:'+'a'.repeat(32);
test('recorded questions preserve separate instructions, text and image; model answers stay private',()=>{
    const quiz=model.validateQuiz({title:'Oral work',questions:[question]},true),safe=model.publicQuestions(quiz);
    assert.deepEqual(model.validateQuiz(quiz,true),quiz);
    assert.equal(safe[0].content,question.content);assert.equal(safe[0].image.src,question.image.src);assert.equal(safe[0].answer,undefined);
    assert.equal(safe[0].responseCount,1);assert(model.validAnswers(quiz,[[reference]]));
    for(const answer of [[''],['spoken text'],['data:audio/webm;base64,AAAA'],[reference,reference]])assert(!model.validAnswers(quiz,[answer]));
    assert(model.validAnswers(quiz,[['']],true));assert(model.validAnswers({questions:[{...question,extraCredit:true}]},[['']]));
    for(const content of [5,'a'.repeat(10001)])assert.throws(()=>model.validateQuiz({title:'Invalid',questions:[{...question,content}]},true));
    assert.doesNotThrow(()=>model.validateQuiz({title:'Instructions only',questions:[{...question,content:'',image:undefined}]},true));
    assert.equal(model.grade(quiz,[[reference]]).pending,1);assert.deepEqual(scoring.feedback(quiz.questions,[[reference]],true),[]);
    const grading=model.grade(quiz,[[reference]],{scores:[2.5],explanations:{0:'Read more slowly.'}});
    assert.equal(grading.total,2.5);assert.equal(grading.manual[0].explanation,'Read more slowly.');assert.equal(grading.manual[0].modelAnswer,'Private rubric');
    assert(!model.validCorrections(quiz,[2.25]));
    const mixed={questions:[{...question,type:'text'},{...question},{type:'gaps',prompt:'___',wordBank:false,answer:['word'],points:1}]};
    assert.deepEqual(model.grade(mixed,[['text'],[reference],['word']],{scores:[2]}).manual.map(q=>q.score),[2,null,null]);
});
test('audio uploads enforce container, size, canonical encoding and bounded duration',()=>{
    for(const [mime,bytes] of [['audio/webm;codecs=opus',Buffer.from([0x1a,0x45,0xdf,0xa3,0,0])],['audio/mp4',Buffer.from('\0\0\0\x18ftypisom')],['audio/ogg;codecs=opus',Buffer.from('OggSxxxx')]]){
        const value={audio:'data:'+mime+';base64,'+bytes.toString('base64'),durationMs:1000};assert.deepEqual(validateRecording(value),value);
        assert.throws(()=>validateRecording({...value,durationMs:180001}));assert.throws(()=>validateRecording({...value,durationMs:0}));
    }
    for(const audio of ['https://example.test/audio.mp3','data:text/html;base64,SGk=','data:audio/webm;base64,SGk=','data:audio/mp4;base64,GkXfow==','data:audio/webm;base64,GkXfow=','data:audio/webm;base64,'+Buffer.alloc(UPLOAD_BYTES+1).toString('base64')])assert.throws(()=>validateRecording({audio,durationMs:1000}));
});
test('browser format-label variations share validation without weakening audio checks',()=>{
    const settings=require('../Penina-Quizzes/custom/recording-settings');
    const bytes=Buffer.from('\0\0\0\x18ftypisom');
    for(const mime of ['audio/mp4;codecs="mp4a.40.2"','audio/mp4; codecs=mp4a.40.2','AUDIO/MP4; CODECS = "mp4a.40.2"','audio/mp4;codecs="mp4a.40.2"; profiles="isom,iso2"']){
        const audio='data:'+mime+';base64,'+bytes.toString('base64'),value={audio,durationMs:1000};
        assert.equal(settings.parseAudio(audio).mime,'audio/mp4');
        assert.deepEqual(validateRecording(value),value,'keep stored bytes and header stable for retries');
        assert.deepEqual([...settings.uploads(audio,1000)],[value]);
    }
    for(const mime of ['text/html','video/mp4','audio/mp4;codecs="mp4a.40.2','audio/mp4;codecs=mp4a.40.2"','audio/mp4;codecs="<script>"','audio/mp4\n','audio/mp4;'+ ' '.repeat(300)+'codecs=mp4a.40.2']){
        const audio='data:'+mime+';base64,'+bytes.toString('base64');
        assert.equal(settings.parseAudio(audio),null);assert.throws(()=>validateRecording({audio,durationMs:1000}));
    }
    for(const encoded of ['GkXfowAAAA==','!!!!','AAAA\n','AAAA=']){
        assert.throws(()=>validateRecording({audio:'data:audio/mp4; codecs="mp4a.40.2";base64,'+encoded,durationMs:1000}));
    }
});
test('quoted format parameters containing commas survive split upload and playback',async()=>{
    const settings=require('../Penina-Quizzes/custom/recording-settings'),vm=require('node:vm'),fs=require('node:fs');
    const context={QuizRecordingSettings:settings};vm.runInNewContext(fs.readFileSync(require.resolve('../Penina-Quizzes/custom/recording.js'),'utf8')+'\nthis.recording=QuizRecording;',context);
    const bytes=Buffer.alloc(UPLOAD_BYTES+101,17);bytes.write('ftyp',4);
    const audio='data:audio/mp4; codecs="mp4a.40.2"; profiles="isom,iso2";base64,'+bytes.toString('base64');
    const parts=[...settings.uploads(audio,1000)];
    assert.equal(parts.length,2);
    const manifest=completeRecording(parts,parts.at(-1),{});
    const restored=await context.recording.loadRecording(async body=>body.part===undefined?manifest:parts[body.part],{});
    assert.equal(restored.audio,audio);
    assert.equal(manifest.totalBytes,bytes.length);
});
test('print and corrected email describe recorded work without leaking keys or raw recording identifiers',()=>{
    const quiz={title:'Oral work',questions:[question]},answers=[[reference]],grading=model.grade(quiz,answers,{scores:[3],feedback:'Well read.'});
    const paper=require('../Penina-Quizzes/builder/print').render(quiz);
    assert.match(paper,/Record your answer in the online quiz/);assert.match(paper,/בְּרֵאשִׁית/);assert.match(paper,/&lt;script&gt;/);assert(!paper.includes('Private rubric'));
    const email=require('../lib/quiz-correction-email').correctedTest({title:quiz.title,questions:quiz.questions,record:{name:'Student',answers},grading});
    assert.match(email.text,/Recorded answer submitted/);assert(!email.html.includes(reference));assert(!email.html.includes('Private rubric'));
});

test('teacher-selected recording limits validate, persist, reach students and apply to uploads',()=>{
    const settings=require('../Penina-Quizzes/custom/recording-settings');
    assert.equal(settings.minutes(question),3,'previous questions keep their original default');
    for(const recordingMinutes of [3,5,10]){
        const quiz=model.validateQuiz({title:'Oral work',questions:[{...question,recordingMinutes}]},true);
        assert.equal(model.publicQuestions(quiz)[0].recordingMinutes,recordingMinutes);
        assert.equal(model.validateQuiz(JSON.parse(JSON.stringify(quiz)),true).questions[0].recordingMinutes,recordingMinutes);
        assert.equal(require('../Penina-Quizzes/picture').copyQuestion(quiz.questions[0]).recordingMinutes,recordingMinutes);
        const value={audio:'data:audio/webm;base64,GkXfowAAAA==',durationMs:recordingMinutes*60000};
        assert.equal(validateRecording(value,quiz.questions[0]).durationMs,value.durationMs);
        assert.throws(()=>validateRecording({...value,durationMs:value.durationMs+1},quiz.questions[0]));
        assert.match(require('../Penina-Quizzes/builder/print').render(quiz),new RegExp('up to '+recordingMinutes+' minute'));
    }
    for(const recordingMinutes of [0,-1,1,4,7,30,31,1.5,'5',NaN,Infinity])assert.throws(()=>model.validateQuiz({title:'Invalid',questions:[{...question,recordingMinutes}]}),/3, 5, or 10/);
    const long={audio:'data:audio/webm;base64,GkXfowAAAA==',durationMs:420000,recordingMinutes:30};
    assert.throws(()=>validateRecording(long,{recordingMinutes:1}),/1 minute/,'an upload cannot override the published question limit');
});
test('larger audio splits into bounded parts and only completes with a consistent full recording',()=>{
    const settings=require('../Penina-Quizzes/custom/recording-settings'),bytes=Buffer.alloc(UPLOAD_BYTES+101,17);
    bytes.set([0x1a,0x45,0xdf,0xa3]);
    const audio='data:audio/webm;codecs=opus;base64,'+bytes.toString('base64');
    const question={recordingMinutes:10},parts=[...settings.uploads(audio,600000)];
    assert.equal(parts.length,2);assert(parts.every(part=>Buffer.byteLength(JSON.stringify(part))<3000000));
    for(const part of parts)assert.deepEqual(validateRecording(part,question),part);
    const manifest=completeRecording([...parts],parts.at(-1),question);assert(manifest.chunked);assert.equal(manifest.totalBytes,bytes.length);
    assert.equal(manifest.header+','+parts.map(part=>part.audio.split(',')[1]).join(''),audio);
    assert.throws(()=>completeRecording([parts[1]],parts[1],question),/missing parts/);
    assert.throws(()=>completeRecording([parts[0],{...parts[1],durationMs:2000}],parts[1],question),/missing parts/);
    for(const override of [{part:-1},{part:2},{totalParts:3},{totalBytes:settings.MAX_BYTES+1},{audio:parts[0].audio.slice(0,-4)},{durationMs:600001}])assert.throws(()=>validateRecording({...parts[0],...override},question));
});

test('student and teacher playback reassemble every authenticated audio part and reject incomplete replies',async()=>{
    const settings=require('../Penina-Quizzes/custom/recording-settings'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
    const context={QuizRecordingSettings:settings};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../Penina-Quizzes/custom/recording.js'),'utf8')+'\nthis.recording=QuizRecording;',context);
    const bytes=Buffer.alloc(UPLOAD_BYTES+101,17);bytes.set([0x1a,0x45,0xdf,0xa3]);
    const audio='data:audio/webm;base64,'+bytes.toString('base64'),parts=[...settings.uploads(audio,420000)],manifest=completeRecording([...parts],parts.at(-1),{recordingMinutes:7});
    for(const action of ['recording-load','recording-review']){
        const calls=[],record={action,id:'attempt',token:'private',index:2,reference};
        const restored=await context.recording.loadRecording(async body=>{calls.push(JSON.parse(JSON.stringify(body)));return body.part===undefined?manifest:parts[body.part];},record);
        assert.equal(restored.audio,audio);assert.equal(restored.durationMs,420000);
        assert.deepEqual(calls,[record,{...record,part:0},{...record,part:1}]);
        await assert.rejects(context.recording.loadRecording(async body=>body.part===undefined?manifest:{...parts[body.part],totalBytes:1},record),/part could not/);
    }
    assert.match(context.recording.controls(2,{recordingMinutes:7}),/Maximum: 7 minutes/);
});
