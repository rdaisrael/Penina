const test=require('node:test'),assert=require('node:assert/strict');
const print=require('../Penina-Quizzes/builder/print');
const question=overrides=>({type:'text',prompt:'Explain your thinking.',points:2,direction:'ltr',answer:'PRIVATE MODEL ANSWER',...overrides});

test('Worksheet includes current totals and student fields, omits private keys, and never mutates the draft',()=>{
    const quiz={title:'Review <one>',durationMinutes:40,checkpointMessage:'PRIVATE CHECKPOINT',vocabulary:{secret:'PRIVATE SOURCE'},questions:[
        question({potentialPoints:3}),
        question({type:'choice',choices:['One','Two'],answer:['Two']}),
        question({type:'multi',choices:['Red','Blue','Green'],answer:['Red','Blue'],scoringMode:'response'}),
        question({type:'gaps',prompt:'Write ___ and ___.',wordBank:false,answer:['PRIVATE BLANK','PRIVATE BLANK']}),
        question({type:'match',items:['Term','Unused term'],choices:['Definition','Unused definition'],answer:['Definition',''],scoringMode:'response'}),
        question({type:'order',choices:['First','Second'],answer:['Second','First']}),
        question({extraCredit:true})
    ]};
    const before=structuredClone(quiz),html=print.render(quiz,()=>0);
    assert.deepEqual(quiz,before);
    assert.match(html,/Review &lt;one&gt;/);
    assert.match(html,/15 points/);assert.match(html,/2 extra-credit points/);assert.match(html,/40 minutes/);
    assert.match(html,/Name <span>/);assert.match(html,/Date <span>/);assert.match(html,/Class <span>/);
    assert.equal((html.match(/class="qp-question"/g)||[]).length,7);
    assert.equal((html.match(/class="qp-blank"/g)||[]).length,2);
    assert.match(html,/Make 1 match\./);assert.match(html,/Leave unmatched terms blank/);
    assert.match(html,/Circle one answer/);assert.match(html,/Check all correct answers/);
    assert.doesNotMatch(html,/PRIVATE|correctAnswers|pictureAnswers|vocabulary|checkpoint|checked=|<script/);
    assert.match(html,/qp-order/);
});

test('Word banks are independent of the answer key, repeated blanks survive, and HTML is escaped',()=>{
    const q=question({type:'gaps',prompt:'___ then ___ <script>alert(1)</script>',choices:['First','Second','<img onerror=alert(1)>'],answer:['First','First'],sentence:'PRIVATE AUTHORING SENTENCE'});
    const first=print.render({questions:[q]},()=>0);
    const second=print.render({questions:[{...q,answer:['Second','Second']}]},()=>0);
    assert.equal(first,second);
    assert.equal((first.match(/class="qp-blank"/g)||[]).length,2);
    assert.match(first,/&lt;script&gt;/);assert.match(first,/&lt;img onerror/);
    assert.doesNotMatch(first,/<script|<img|PRIVATE AUTHORING/);
    assert(first.indexOf('dir="auto">Second')<first.indexOf('dir="auto">First'),'the bank does not retain the authoring order with this shuffle');
});

test('Hebrew, picture markers, marker answer spaces and potential points survive without model answers',()=>{
    const q=question({pictureQuestion:true,pictureResponseMode:'markers',pictureAnswers:['PRIVATE ONE','PRIVATE TWO'],prompt:'מה רואים בתמונה?',direction:'rtl',scoringMode:'response',image:{src:'data:image/png;base64,AAAA',alt:'A diagram',markers:[{x:.2,y:.3},{x:.8,y:.6}]}});
    const html=print.render({questions:[q]});
    assert.match(html,/dir="rtl">מה רואים/);assert.match(html,/4 points/);
    assert.equal((html.match(/class="qp-marker-answer"/g)||[]).length,2);
    assert.match(html,/left:20%;top:30%/);assert.match(html,/left:80%;top:60%/);
    assert.doesNotMatch(html,/PRIVATE/);
    assert.doesNotMatch(print.render({questions:[question({image:{src:'javascript:alert(1)',alt:'Unsafe'}})]}),/javascript:|<img/);
    assert.throws(()=>print.render({questions:[]}),/Add at least one question/);
});
