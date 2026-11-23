const test=require('node:test'),assert=require('node:assert/strict');
const {verifyWorksheet,parseRows,matches}=require('../lib/binyan-dicta');
const {items,payload}=require('./fixtures/binyan-dicta-paal.json');
test('live Dicta fixture verifies 71 Paal forms across five tenses and six roots',async()=>{
    assert.equal(items.length,71);
    await verifyWorksheet({lessons:[],questions:items},{},async()=>payload);
});
test('authenticated production Dicta response verifies all four standard Piel present forms',async()=>{
    const recorded=require('./fixtures/binyan-dicta-piel-authenticated.json');
    assert.equal(recorded.items.length,4);
    await verifyWorksheet({lessons:[],questions:recorded.items},{},async()=>recorded.payload);
});
test('wrong root, binyan, tense, person, gender, number or pointing is rejected',()=>{
    const row=parseRows(payload).find(r=>r.POS==='VERB');
    assert.equal(matches(row,items[0]),true);
    for(const change of [{lex:'למד'},{Binyan:'BINYAN_PIEL'},{Tense:'FUTURE'},{Person:'PERSON_3'},{Number:'PLURAL'},{Prefix:'HE'},{Suffix:'X'},{menukad:'כִּתַּבְתִּי'},{POS:'NOUN'}])assert.equal(matches({...row,...change},items[0]),false);
    const female=items.find(i=>i.person==='second_f_sg'&&i.pair.endsWith('עבר'));
    const femaleRow=parseRows(payload).find(r=>r.menukad===female.answer);
    assert.equal(matches({...femaleRow,Gender:'MASCULINE'},female),false);
});
test('failed, missing, reordered and extra analysis never produces a worksheet',async()=>{
    const result={lessons:[],questions:items};
    await assert.rejects(verifyWorksheet(result,{},async()=>({})),/analysis/);
    await assert.rejects(verifyWorksheet(result,{},async()=>{throw new Error('outage');}),/outage/);
    await assert.rejects(verifyWorksheet(result,{},async()=>({...payload,BGU:payload.BGU.replace('כָּתַבְתִּי','כִּתַּבְתִּי')})),/verify/);
    await assert.rejects(verifyWorksheet(result,{},async()=>({...payload,BGU:payload.BGU+'unexpected\n'})),/unexpected/);
});

// Hand-built BGU contract fixtures, not recordings from the live service.
// Exercise the selected-binyan check with actual representative pointed forms.
const binyanExamples=[
    ['פעל','BINYAN_PAAL','כתב','כָּתַב'],
    ['פיעל','BINYAN_PIEL','למד','לִמֵּד'],
    ['הפעיל','BINYAN_HIFIL','כתב','הִכְתִּיב'],
    ['התפעל','BINYAN_HITPAEL','לבש','הִתְלַבֵּשׁ'],
    ['נפעל','BINYAN_NIFAL','כתב','נִכְתַּב'],
    ['פועל','BINYAN_PUAL','ספר','סֻפַּר'],
    ['הופעל','BINYAN_HUFAL','כנס','הֻכְנַס']
];
const pastRow=(code,root,answer)=>({word:answer,menukad:answer,lex:root,POS:'VERB',Binyan:code,Tense:'PAST',Person:'PERSON_3',Number:'SINGULAR',Gender:'MASCULINE',Prefix:'',Suffix:'',fAramaic:'False'});
test('verification accepts each selected binyan and rejects every wrong binyan',async()=>{
    const rows=[],questions=[];
    for(const [binyan,code,root,answer] of binyanExamples){
        const item={pair:`${binyan} שלם|עבר`,root,answer,person:'third_m_sg'};
        const row=pastRow(code,root,answer);
        assert.equal(matches(row,item),true,binyan);
        for(const [,otherCode] of binyanExamples)if(otherCode!==code)assert.equal(matches({...row,Binyan:otherCode},item),false,`${binyan}: ${otherCode}`);
        for(const change of [{lex:'סגר'},{Tense:'FUTURE'},{Person:'PERSON_1'},{Number:'PLURAL'},{Gender:'FEMININE'},{Prefix:'HE'},{Suffix:'X'},{menukad:'סָגַר'},{POS:'NOUN'}])assert.equal(matches({...row,...change},item),false,binyan);
        questions.push(item);rows.push({word:'הוּא'},row,{word:'.'});
    }
    const keys=Object.keys(rows[1]);
    const BGU=[keys.join('\t'),...rows.map(row=>keys.map(key=>row[key]||'').join('\t'))].join('\n');
    await verifyWorksheet({lessons:[],questions},{},async()=>({BGU}));
    await assert.rejects(verifyWorksheet({lessons:[],questions},{},async()=>({BGU:BGU.replace('BINYAN_PIEL','BINYAN_PAAL')})),/Could not verify/);
});
test('final-hey root notation works across binyanim without allowing unrelated roots',()=>{
    const item={pair:'פיעל ל-ה|עבר',root:'נסה',answer:'נִסָּה',person:'third_m_sg'};
    const row=pastRow('BINYAN_PIEL','נסי',item.answer);
    assert.equal(matches(row,item),true);
    assert.equal(matches(row,{...item,pair:'פיעל — כל הגזרות|עבר'}),true);
    assert.equal(matches(row,{...item,root:'נסע'}),false);
    assert.equal(matches({...row,Binyan:'BINYAN_PAAL'},item),false);
});
