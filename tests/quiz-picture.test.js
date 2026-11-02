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

const picture=require('../Penina-Quizzes/picture');
function fiveMarkers(){
 const quiz=fixture();for(let i=1;i<5;i++){const q=picture.addMarker(quiz.questions,quiz.questions[0]);q.prompt='Identify marker '+(i+1);q.answer='Answer '+(i+1);q.points=i+1;}
 return quiz;
}
test('five markers survive save/reload with independent answers and grades and no leaked keys',()=>{
 const quiz=model.validateQuiz(JSON.parse(JSON.stringify(fiveMarkers())),true);
 assert.equal(quiz.questions.length,5);assert.deepEqual(quiz.questions.map(q=>q.markerIndex),[0,1,2,3,4]);
 assert(quiz.questions.every(q=>q.image.markers.length===5));
 assert.deepEqual(model.validateQuiz(quiz,true),quiz);
 const safe=model.publicQuestions(quiz);assert(safe.every(q=>!('answer' in q)&&!('pictureGroup' in q)));assert.equal(safe[4].markerIndex,4);
 assert(model.validAnswers(quiz,[['one'],['two'],['three'],['four'],['five']]));assert(!model.validAnswers(quiz,[['one'],['two'],[''],['four'],['five']]));
 const pending=model.grade(quiz,[]);assert.equal(pending.pending,5);
 const graded=model.grade(quiz,[],{scores:[2,0,3,1,5]});assert.equal(graded.total,11);assert.equal(graded.pending,0);assert.deepEqual(graded.manual.map(q=>q.modelAnswer),quiz.questions.map(q=>q.answer));
 const html=picture.render(safe[3]);assert.match(html,/Marker 4, current question/);assert.equal((html.match(/class="picture-marker /g)||[]).length,5);assert(!html.includes('Answer 4'));
});
test('moving, replacing, removing and copying markers preserves each remaining question',()=>{
 let quiz=JSON.parse(JSON.stringify(fiveMarkers()));const q=quiz.questions[2];
 picture.setMarker(quiz.questions,q,{x:0.1,y:0.9});assert(quiz.questions.every(item=>item.image.markers[2].x===0.1));
 picture.replaceImage(quiz.questions,q,{...image,alt:'Replacement'});assert(quiz.questions.every(item=>item.image.alt==='Replacement'&&item.image.markers.length===5));
 const copy=picture.copyQuestion(q);assert.equal(copy.pictureGroup,undefined);assert.equal(copy.markerIndex,undefined);assert.deepEqual(copy.image.marker,{x:0.1,y:0.9});assert.equal(copy.answer,'Answer 3');
 picture.removeQuestion(quiz.questions,quiz.questions[1]);assert.deepEqual(quiz.questions.map(q=>q.markerIndex),[0,1,2,3]);assert.equal(q.answer,'Answer 3');assert(quiz.questions.every(item=>item.image.markers.length===4));assert.doesNotThrow(()=>model.validateQuiz(quiz,true));
 quiz.questions.reverse();picture.addMarker(quiz.questions,q);assert.deepEqual(quiz.questions.map(q=>q.markerIndex),[3,2,1,0,4]);assert.equal(quiz.questions[4].answer,'');
});
test('incomplete groups, duplicate marker assignments and malformed coordinates cannot save',()=>{
 for(const mutate of [q=>q.questions.pop(),q=>q.questions[1].markerIndex=0,q=>q.questions[0].image.markers[0].x=NaN,q=>q.questions[0].markerIndex=5,q=>q.questions[0].image.alt='Different',q=>q.questions[0].image.markers=[]]){
  const quiz=fiveMarkers();mutate(quiz);assert.throws(()=>model.validateQuiz(quiz,true));
 }
 const quiz=fiveMarkers();while(quiz.questions.length<20)picture.addMarker(quiz.questions,quiz.questions[0]);assert.throws(()=>picture.addMarker(quiz.questions,quiz.questions[0]),/20 markers/);
});
