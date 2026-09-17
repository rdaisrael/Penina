const test=require('node:test'),assert=require('node:assert/strict');
const {verifyWorksheet,parseRows,matches}=require('../lib/binyan-dicta');
const {items,payload}=require('./fixtures/binyan-dicta-paal.json');
test('live Dicta fixture verifies 71 Paal forms across five tenses and six roots',async()=>{
    assert.equal(items.length,71);
    await verifyWorksheet({lessons:[],questions:items},{},async()=>payload);
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
