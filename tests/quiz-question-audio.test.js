const test=require('node:test'),assert=require('node:assert/strict');
const audio=require('../Penina-Quizzes/question-audio'),model=require('../lib/quiz-builder-model');
const conversion=require('../Penina-Quizzes/builder/question-conversion'),print=require('../Penina-Quizzes/builder/print');
const teacherAudio={id:'a'.repeat(64),durationMs:300000};
const image={src:'data:image/png;base64,iVBORw0KGgo=',alt:'Question illustration',marker:null};
const questions=[
 {type:'text',answer:'Private rubric'},
 {type:'recording',answer:'Private rubric',recordingMinutes:3},
 {type:'choice',choices:['A','B'],answer:['B']},
 {type:'multi',choices:['A','B'],answer:['A','B']},
 {type:'gaps',prompt:'___',choices:['A','B'],answer:['A']},
 {type:'order',choices:['A','B'],answer:['B','A']},
 {type:'match',items:['1','2','3','4'],choices:['A','B'],answer:['A','B','A','B']},
 {type:'section',content:''}
].map(q=>({prompt:'Question',points:1,...q,image,teacherAudio}));
test('every question type retains optional picture and teacher audio without exposing answer keys',()=>{
 const quiz=model.validateQuiz({title:'Media',questions},true),safe=model.publicQuestions(quiz);
 assert.deepEqual(model.validateQuiz(quiz,true),quiz);
 for(const q of safe){assert.deepEqual(q.image,image);assert.deepEqual(q.teacherAudio,teacherAudio);assert.equal(q.answer,undefined);}
 for(const q of questions){const plain={...q};delete plain.teacherAudio;delete plain.image;assert.doesNotThrow(()=>model.validateQuiz({title:'Optional',questions:[questions[0],plain]},true));}
 assert.doesNotThrow(()=>model.validateQuiz({title:'Audio section',questions:[{type:'section',teacherAudio},questions[0]]},true));
 const picture={...questions[0],pictureQuestion:true};delete picture.image;
 assert.throws(()=>model.validateQuiz({title:'Required',questions:[picture]},true),/upload a picture/);
 assert.doesNotThrow(()=>model.validateQuiz({title:'No targets',questions:[{...picture,image}]},true));
 for(const value of [{id:'https://example.com/a.wav',durationMs:1},{...teacherAudio,durationMs:300001},{...teacherAudio,durationMs:0},{...teacherAudio,durationMs:NaN}])assert.throws(()=>model.validateQuiz({title:'Bad',questions:[{...questions[0],teacherAudio:value}]}),/5 minutes/);
});
test('question conversion and printing preserve teacher audio context',()=>{
 for(const target of ['text','picture','choice','gaps'])assert.deepEqual(conversion.create({...questions[0],conversionDistractors:['Wrong']},target).teacherAudio,teacherAudio);
 const markup=print.render({title:'Media',questions});assert.equal((markup.match(/Listen to the teacher recording/g)||[]).length,questions.length);assert(!markup.includes(teacherAudio.id));
});
test('canonical audio validation measures real duration and rejects corrupt or overlong files',()=>{
 for(const seconds of [.1,1,300]){const wav=audio.encode(new Float32Array(seconds*audio.RATE));assert.equal(audio.inspect(wav),seconds*1000);}
 const wav=audio.encode(new Float32Array(audio.RATE));
 for(const at of [0,4,8,12,16,20,22,24,28,32,34,36,40]){const bad=wav.slice();bad[at]^=1;assert.throws(()=>audio.inspect(bad));}
 assert.throws(()=>audio.encode(new Float32Array(301*audio.RATE)),/5 minutes/);
 assert.throws(()=>audio.inspect(wav.slice(0,-1)));
});
