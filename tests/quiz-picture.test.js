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
 for(const src of ['https://example.com/a.png','data:image/svg+xml;base64,AAAA','data:image/png;base64,AAA" onerror="alert(1)','data:image/png;base64,'+'A'.repeat(2500000)]){
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
 const quiz=fiveMarkers();while(quiz.questions.length<5)picture.addMarker(quiz.questions,quiz.questions[0]);assert.throws(()=>picture.addMarker(quiz.questions,quiz.questions[0]),/5 markers/);
});

test('one picture question holds several markers with shared or per-marker answers and scoring',()=>{
 const quiz=fixture(),q=quiz.questions[0];
 for(let i=1;i<5;i++)picture.addQuestionMarker(q);
 assert.equal(quiz.questions.length,1);assert.equal(q.image.markers.length,5);
 q.pictureAnswers=['First','Second','Third','Fourth','Fifth'];q.scoringMode='response';
 const saved=model.validateQuiz(JSON.parse(JSON.stringify(quiz)),true),question=saved.questions[0];
 assert.equal(model.responseCount(question),5);assert.equal(model.maxPoints(question),10);
 const safe=model.publicQuestions(saved)[0];assert.equal(safe.pictureResponseMode,'markers');assert.equal(safe.responseCount,5);
 assert.equal(safe.answer,undefined);assert.equal(safe.pictureAnswers,undefined);
 assert(model.validAnswers(saved,[['one','two','three','four','five']]));
 assert(!model.validAnswers(saved,[['one']]));assert(!model.validAnswers(saved,[['one','two','','four','five']]));
 assert(model.validAnswers(saved,[['','','','','']],true));
 const pending=model.grade(saved,[question.pictureAnswers]);assert.equal(pending.pending,1,'written marker answers require correction even when exact');
 assert.equal(pending.manual[0].max,10);assert.match(pending.manual[0].modelAnswer,/Marker 5: Fifth/);
 const graded=model.grade(saved,[question.pictureAnswers],{scores:[8]});assert.equal(graded.total,8);assert.equal(graded.baseMax,10);
 assert.deepEqual(picture.copyQuestion(question),question,'duplicate retains all markers and answers');
 question.scoringMode='total';assert.equal(model.maxPoints(question),2);
 question.pictureResponseMode='shared';question.scoringMode='response';assert.equal(model.responseCount(question),1);assert.equal(model.maxPoints(question),2);
 assert(model.validAnswers(saved,[['One answer covering the picture']]));assert(!model.validAnswers(saved,[['one','two']]));
 assert.equal(model.grade(saved,[['answer']]).manual[0].modelAnswer,question.answer);
 assert.deepEqual(model.validateQuiz(saved,true).questions[0].pictureAnswers,question.pictureAnswers,'switching to shared retains private marker answers');
 assert.doesNotMatch(picture.render(model.publicQuestions(saved)[0]),/current marker|current question/);
});
test('standalone marker edits preserve the other locations and answers without mutating a copy',()=>{
 const q=fixture().questions[0];picture.addQuestionMarker(q);picture.addQuestionMarker(q);q.pictureAnswers=['first','second','third'];
 const before=structuredClone(q),copy=picture.copyQuestion(q);picture.setMarker([q],q,{x:.8,y:.2},1);
 assert.deepEqual(q.image.markers[0],before.image.markers[0]);assert.deepEqual(q.image.markers[2],before.image.markers[2]);assert.deepEqual(copy,before);
 picture.removeMarker(q,1);assert.deepEqual(q.pictureAnswers,['first','third']);assert.equal(q.image.markers.length,2);
 picture.replaceImage([q],q,{...image,alt:'New diagram'});assert.equal(q.image.markers.length,2);assert.equal(q.image.alt,'New diagram');
 assert.doesNotThrow(()=>model.validateQuiz({title:'Markers',questions:[q]},true));
 const noMarker=fixture().questions[0];noMarker.image.marker=null;picture.addQuestionMarker(noMarker);assert.equal(noMarker.image.markers.length,1);
 picture.removeMarker(noMarker,0);assert.equal(noMarker.image.markers,undefined);assert.equal(noMarker.pictureAnswers,undefined);
 assert.doesNotThrow(()=>model.validateQuiz({title:'No markers',questions:[noMarker]},true));
});
test('standalone markers validate answer count, modes, limits and cannot lose responses through conversion',()=>{
 const q=fixture().questions[0];picture.addQuestionMarker(q);
 for(const mutate of [q=>q.pictureAnswers.pop(),q=>delete q.pictureAnswers,q=>q.pictureAnswers[0]=7,q=>q.pictureAnswers[0]='a'.repeat(5001),q=>q.pictureResponseMode='unknown',q=>q.pictureGroup='legacy',q=>q.markerIndex=0,q=>q.image.markers[0].x=2]){
  const broken=structuredClone(q);mutate(broken);assert.throws(()=>model.validateQuiz({title:'Invalid',questions:[broken]},true));
 }
 assert.throws(()=>require('../Penina-Quizzes/builder/question-conversion').create(q,'text'),/markers and answers stay together/);
 while(q.image.markers.length<5)picture.addQuestionMarker(q);const before=JSON.stringify(q);assert.throws(()=>picture.addQuestionMarker(q),/5 markers/);assert.equal(JSON.stringify(q),before);
 q.image.markers.push({x:.5,y:.5});q.pictureAnswers.push('Sixth');assert.throws(()=>model.validateQuiz({title:'Too many markers',questions:[q]},true),/1–5 markers/);
});
test('imported lettered targets can become numbered markers without conflicting marker formats',()=>{
 const q=fixture().questions[0];q.image.targets=[{x:.1,y:.2},{x:.7,y:.8}];picture.addQuestionMarker(q);
 assert.equal(q.pictureResponseMode,'shared');assert.equal(q.image.targets,undefined);assert.equal(q.image.markers.length,3);
 assert.doesNotThrow(()=>model.validateQuiz({title:'Imported',questions:[q]},true));
});

test('adding markers to a saved one-marker group keeps the same question through save and reload',()=>{
 const quiz=fixture(),q=quiz.questions[0];
 q.pictureGroup='saved-draft';q.markerIndex=0;q.image.markers=[q.image.marker];q.image.marker=null;
 for(let i=1;i<5;i++){
  picture.addQuestionMarker(q,quiz.questions);
  assert.equal(quiz.questions.length,1);assert.equal(q.image.markers.length,i+1);
 }
 assert.equal(q.pictureGroup,undefined);assert.equal(q.markerIndex,undefined);
 assert.equal(q.prompt,'What is marked?');assert.equal(q.answer,'Model answer');assert.equal(q.pictureAnswers[0],'Model answer');
 const saved=model.validateQuiz(JSON.parse(JSON.stringify(quiz)),true);
 assert.equal(saved.questions.length,1);assert.equal(saved.questions[0].image.markers.length,5);
 assert.equal(saved.questions[0].pictureResponseMode,'markers');
 const before=JSON.stringify(quiz);assert.throws(()=>picture.addQuestionMarker(q,quiz.questions),/5 markers/);assert.equal(JSON.stringify(quiz),before);
});

test('editing an authored legacy group never adds or discards questions, answers, positions or point settings',()=>{
 const quiz=fiveMarkers();picture.removeQuestion(quiz.questions,quiz.questions[4]);
 const before=structuredClone(quiz.questions),edited=quiz.questions[2];
 quiz.questions.reverse(); // Question order need not match marker order.
 picture.addQuestionMarker(edited,quiz.questions);
 assert.equal(quiz.questions.length,4);assert.equal(edited.image.markers.length,5);
 for(const q of quiz.questions){
  const original=before.find(item=>item.prompt===q.prompt);
  for(const field of ['answer','points','scoringMode','direction','extraCredit','allowHalfCredit'])assert.deepEqual(q[field],original[field]);
  assert.equal(q.pictureGroup,undefined);assert.equal(q.pictureResponseMode,'shared');
  assert.equal(model.responseCount(q),1);assert.equal(model.maxPoints(q),model.maxPoints(original));
  if(q!==edited){assert.deepEqual(q.image,original.image);assert.equal(q.markerIndex,original.markerIndex);}
 }
 assert.equal(edited.markerIndex,undefined);assert.deepEqual(edited.pictureAnswers,['Model answer','Answer 2','Answer 3','Answer 4','']);
 const saved=model.validateQuiz(JSON.parse(JSON.stringify(quiz)),true),safe=model.publicQuestions(saved);
 assert(safe.every(q=>!('pictureAnswers' in q)&&!('answer' in q)));
 const unchanged=saved.questions.find(q=>q.markerIndex===1);
 assert.match(picture.render(safe.find(q=>q.markerIndex===1)),/Answer about marker <strong>2/);
 assert.match(picture.render(unchanged,true,0),/Editing marker <strong>1/);
 picture.removeMarker(unchanged,0);assert.equal(unchanged.markerIndex,0);assert.doesNotThrow(()=>model.validateQuiz(saved,true));
 picture.removeMarker(unchanged,0);assert.equal(unchanged.markerIndex,undefined);assert.doesNotThrow(()=>model.validateQuiz(saved,true));
 for(const markerIndex of [-1,8,0.5]){const invalid=structuredClone(saved);invalid.questions[0].markerIndex=markerIndex;assert.throws(()=>model.validateQuiz(invalid,true),/choose the marker/);}
});

test('full or incomplete legacy groups fail without partially changing the saved quiz',()=>{
 for(const quiz of [fiveMarkers(),fixture()]){
  const q=quiz.questions[0];
  if(!q.pictureGroup){q.pictureGroup='missing-member';q.markerIndex=0;q.image.markers=[{x:.2,y:.3},{x:.7,y:.8}];q.image.marker=null;}
  const before=JSON.stringify(quiz);assert.throws(()=>picture.addQuestionMarker(q,quiz.questions));assert.equal(JSON.stringify(quiz),before);
 }
});
