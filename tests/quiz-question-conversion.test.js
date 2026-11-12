const test=require('node:test'),assert=require('node:assert/strict');
const conversion=require('../Penina-Quizzes/builder/question-conversion');
const model=require('../lib/quiz-builder-model');
const vocabulary=require('../lib/quiz-vocabulary');
const planner=require('../Penina-Quizzes/builder/vocabulary-plan');
const picture=require('../Penina-Quizzes/picture');
const image={src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=',alt:'House',marker:{x:.3,y:.7}};
const row={word:'בית',definition:'house',definitionDistractors:['river','garden','mountain']};
const choice=()=>({type:'choice',prompt:'Which definition best matches “בית”?',answer:['house'],choices:['river','house','garden','mountain'],points:2.5,allowHalfCredit:true,extraCredit:true,scoringMode:'response',direction:'rtl',vocabularyGenerated:true,vocabularyTerms:[{word:'בית',definition:'house'}]});
const save=q=>model.validateQuiz({title:'Conversion test',questions:[{type:'text',prompt:'Regular question',answer:'Answer',points:1},q]}).questions[1];
const publish=q=>model.validateQuiz({title:'Conversion test',questions:[{type:'text',prompt:'Regular question',answer:'Answer',points:1},q]},true).questions[1];
test('All twelve conversions between the four formats validate and retain scoring, coverage and pictures',()=>{
    for(const from of conversion.types){
        const source=conversion.finish(conversion.create({...choice(),image},from,[row]));
        for(const to of conversion.types.filter(type=>type!==from)){
            const before=structuredClone(source),result=publish(conversion.finish(conversion.create(source,to,[row])));
            assert.equal(conversion.kind(result),to);assert.deepEqual(source,before,'source remains unchanged');
            assert.deepEqual(result.image,image);assert.deepEqual(result.vocabularyTerms,choice().vocabularyTerms);
            assert.equal(result.vocabularyGenerated,true);assert.equal(result.extraCredit,true);
            assert.equal(result.points,2.5);assert.equal(result.allowHalfCredit,true);assert.equal(result.direction,'rtl');
            assert.equal(model.maxPoints(result),2.5);assert.deepEqual(planner.usage([row],[result]),[[1]]);
            assert.equal(result.type==='text'?result.answer:result.answer[0],'house');
            for(const field of ['items','pairs','pictureGroup','markerIndex'])assert.equal(result[field],undefined);
            assert.equal(result.pictureQuestion,to==='picture'?true:undefined);
        }
    }
});
test('Saved incorrect choices survive choice → written → picture → blanks → choice without source rows',()=>{
    let q={...choice(),choices:['house','custom incorrect choice','other wrong answer']};
    for(const type of ['text','picture','gaps','choice'])q=save(conversion.finish(conversion.create(q,type)));
    assert.deepEqual(q.choices,['house','custom incorrect choice','other wrong answer']);
    assert.deepEqual(q.answer,['house']);
    const publicQuestion=model.publicQuestions({questions:[q]})[0];
    assert.equal(publicQuestion.conversionDistractors,undefined);assert.equal(publicQuestion.vocabularyTerms,undefined);
});
test('Generated written questions use only the matching source row’s saved distractors',async()=>{
    const [written]=await vocabulary.questions({rows:[row],types:['text'],autoCount:true});
    const q=conversion.finish(conversion.create(written,'choice',[row]));
    assert.deepEqual(q.choices,['house','river','garden','mountain']);
    assert.throws(()=>conversion.finish(conversion.create({...written,answer:'home'},'choice',[row])),/Add at least one incorrect/);
    assert.throws(()=>conversion.finish(conversion.create(written,'choice',[{...row,definition:'home'}])),/Add at least one incorrect/);
});
test('Teacher prompt and answer edits survive conversion; canonical generated prompts adapt',()=>{
    const q={...choice(),prompt:'Choose the meaning of this word in our passage.',answer:['home'],choices:['home','river']};
    const text=conversion.finish(conversion.create(q,'text'));
    assert.equal(text.prompt,q.prompt);assert.equal(text.answer,'home');
    const gaps=conversion.finish(conversion.create(text,'gaps'));
    assert.equal(gaps.prompt,q.prompt+'\nAnswer: ___');assert.equal(gaps.sentence,q.prompt+'\nAnswer: <<home>>');
    assert.equal(conversion.create(choice(),'text').prompt,'Translate “בית” into English.');
    assert.equal(conversion.create(choice(),'gaps').prompt,'The English meaning of “בית” is ___.');
});
test('Blanks use the edited sentence and answer, not a stale generated answer key',()=>{
    const q={...conversion.create(choice(),'gaps'),sentence:'In this passage, בית means <<home>>.'};
    const result=conversion.finish(conversion.create(q,'choice'));
    assert.equal(result.prompt,'In this passage, בית means ___.');assert.deepEqual(result.answer,['home']);
    assert.equal(result.sentence,undefined);assert.equal(result.distractors,undefined);assert.equal(result.wordBank,undefined);
});
test('Multiple blanks and unsupported formats cannot lose answers through conversion',()=>{
    for(const type of ['multi','match','order'])assert.throws(()=>conversion.create({...choice(),type},'text'),/Change type is available/);
    for(const prompt of ['___ and ___','No blank'])assert.throws(()=>conversion.create({...choice(),type:'gaps',prompt,answer:['house','garden']},'text'),/one completed blank/);
    assert.throws(()=>conversion.create({...choice(),type:'gaps',sentence:'<<house>> and <<river>>'},'picture'),/one completed blank/);
    assert.throws(()=>conversion.create(choice(),'multi'),/supported question type/);
});
test('Numbered picture groups require an independent copy; marker positions survive that copy’s conversion',()=>{
    const original={type:'text',pictureQuestion:true,prompt:'What is marked?',answer:'house',points:1,image:structuredClone(image)},questions=[original];
    picture.addMarker(questions,original);
    const before=structuredClone(questions);
    assert.throws(()=>conversion.create(original,'choice'),/Duplicate this question first/);
    assert.deepEqual(questions,before);
    const independent=picture.copyQuestion(original),q=conversion.create(independent,'choice');q.conversionDistractors=['river'];
    const result=publish(conversion.finish(q));assert.deepEqual(result.image.marker,image.marker);assert.equal(result.image.markers,undefined);
});
test('Knowledge questions preserve their image, lettered targets and wording',()=>{
    const q={...choice(),prompt:'What do targets A and B show?',image:{...image,targets:[{x:.2,y:.3},{x:.8,y:.3}]},vocabularyTerms:[{kind:'knowledge',sourceId:'plants:a',word:'What do targets A and B show?',definition:'house'}]};
    for(const type of conversion.types){const result=save(conversion.finish(conversion.create(q,type)));assert.deepEqual(result.image,q.image);assert.deepEqual(result.vocabularyTerms,q.vocabularyTerms);assert(result.prompt.startsWith(q.prompt));}
});
test('Conversion validation rejects incomplete keys, missing/duplicate distractors, excess lengths and malformed blanks',()=>{
    const q=conversion.create(choice(),'choice');
    assert.throws(()=>conversion.finish({...q,answer:['']}),/correct answer/);
    assert.throws(()=>conversion.finish({...q,conversionDistractors:[]}),/at least one/);
    assert.throws(()=>conversion.finish({...q,conversionDistractors:[' HOUSE ']}),/also be the correct/);
    assert.throws(()=>conversion.finish({...q,conversionDistractors:['river','River']}),/duplicate/);
    assert.throws(()=>conversion.finish({...q,conversionDistractors:['x'.repeat(501)]}),/500 characters/);
    assert.throws(()=>conversion.finish({...q,answer:['x'.repeat(501)]}),/Shorten/);
    for(const sentence of ['<<house>> and ___','<<house>> and <<river>>','<<house','<<>>'])assert.throws(()=>conversion.finish({...conversion.create(q,'gaps'),sentence}),/one completed blank/);
    const pictureDraft=conversion.finish(conversion.create(q,'picture'));assert.doesNotThrow(()=>save(pictureDraft));assert.throws(()=>publish(pictureDraft),/upload a picture/);
});
test('Whitespace around an edited correct answer cannot create a choice missing from the answer key',()=>{
    const q=conversion.create(choice(),'choice');q.answer=['  house  '];
    const result=publish(conversion.finish(q));
    assert.deepEqual(result.answer,['house']);assert(result.choices.includes(result.answer[0]));
});
test('Converted single-response blanks normalize proportional points without changing total points',()=>{
    const q={...conversion.create(choice(),'gaps'),scoringMode:'proportional'};
    const converted=publish(conversion.finish(conversion.create(q,'text')));
    assert.equal(converted.scoringMode,'total');assert.equal(model.maxPoints(converted),model.maxPoints(q));
});
test('Saved conversion metadata validates and cannot be exposed in student responses',()=>{
    for(const conversionDistractors of ['oops',[3],[''],['x'.repeat(501)],Array(50).fill('incorrect')])assert.throws(()=>save({...choice(),conversionDistractors}),/saved incorrect choices/);
    const q=publish({...choice(),conversionDistractors:['private saved distractor']});
    assert(!JSON.stringify(model.publicQuestions({questions:[q]})).includes('private saved distractor'));
});
