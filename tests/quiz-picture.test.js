const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('../lib/quiz-builder-model');
const image={src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=',alt:'A labeled diagram',marker:{x:0.25,y:0.75}};
const fixture=()=>({title:'Picture test',questions:[{type:'text',pictureQuestion:true,prompt:'What is marked?',points:2,answer:'Model answer',image:structuredClone(image)}]});
test('picture questions preserve image and marker while hiding answer keys and requiring teacher grading',()=>{
 const quiz=model.validateQuiz(fixture(),true),q=model.publicQuestions(quiz)[0];
 assert.deepEqual(q.image,image);assert.equal(q.pictureQuestion,true);assert.equal(q.answer,undefined);
 assert.equal(model.validAnswers(quiz,[['A student answer']]),true);assert.equal(model.validAnswers(quiz,[['']]),false);
 assert.equal(model.grade(quiz,[['Answer']]).pending,1);assert.equal(model.grade(quiz,[['Answer']],{scores:[2]}).total,2);
 const copy=require('../Penina-Quizzes/custom/scoring').duplicateQuestions(quiz.questions);assert.deepEqual(copy[0].image,image);
});
test('draft may await image but publishing requires it; unsafe images and invalid markers are rejected',()=>{
 const quiz=fixture();delete quiz.questions[0].image;assert.doesNotThrow(()=>model.validateQuiz(quiz));assert.throws(()=>model.validateQuiz(quiz,true),/upload a picture/);
 for(const src of ['https://example.com/a.png','data:image/svg+xml;base64,AAAA','data:image/png;base64,AAA" onerror="alert(1)','data:image/png;base64,'+'A'.repeat(250000)]){
  const quiz=fixture();quiz.questions[0].image.src=src;assert.throws(()=>model.validateQuiz(quiz,true),/valid JPG/);
 }
 for(const x of [-0.1,1.1,NaN,Infinity,'0.5']){const quiz=fixture();quiz.questions[0].image.marker.x=x;assert.throws(()=>model.validateQuiz(quiz,true),/inside the picture/);}
 const many=fixture();many.questions=Array.from({length:11},()=>({...structuredClone(many.questions[0]),image:{...image,src:'data:image/png;base64,'+'A'.repeat(240000)}}));assert.throws(()=>model.validateQuiz(many,true),/smaller pictures/);
});
test('picture rendering escapes descriptions and uses proportional marker positions',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../Penina-Quizzes/picture.js'),'utf8')+';globalThis.picture=QuizPicture;',context);
 const html=context.picture.render({image:{...image,alt:'<script>"hello"</script>'}},true);
 assert.match(html,/left:25%;top:75%/);assert.match(html,/&lt;script&gt;/);assert.match(html,/tabindex="0"/);assert.doesNotMatch(html,/<script>/);
 assert.equal(context.picture.render({}), '');assert.equal(context.picture.render({image:{src:'javascript:alert(1)'}}),'');
});
