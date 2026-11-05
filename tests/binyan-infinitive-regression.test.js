const test=require('node:test'),assert=require('node:assert/strict');
const {verifyWorksheet,parseRows,matches}=require('../lib/binyan-dicta');
const {items,payload}=require('./fixtures/binyan-dicta-standard-infinitives.json');

test('all 16 vetted full-spelling infinitives verify against actual Dicta defective spelling',async()=>{
    assert.equal(items.length,16);
    const rows=parseRows(payload).filter(row=>row.POS==='VERB');
    assert.equal(rows.length,16);
    for(let i=0;i<items.length;i++){
        assert.notEqual(rows[i].menukad.normalize('NFD'),items[i].answer.normalize('NFD'));
        assert.equal(matches(rows[i],items[i]),true,items[i].root);
    }
    await verifyWorksheet({lessons:[],questions:items},{},async()=>payload);
});

test('spelling equivalence does not admit incorrect vowels, roots, tenses or binyanim',()=>{
    const item=items[0],row=parseRows(payload)[0];
    for(const change of [{menukad:'לִכְתַּב'},{menukad:'לְכַתֵּב'},{lex:'למד'},{Tense:'PAST'},{Binyan:'BINYAN_PIEL'},{Prefix:'HE'},{Suffix:'X'},{POS:'NOUN'}])
        assert.equal(matches({...row,...change},item),false,JSON.stringify(change));
    assert.equal(matches(row,{...item,answer:'לִכְתּוּב'}),false);
    assert.equal(matches(row,{...item,answer:'לִכְתּוֹב',pair:'פעל ל-ה|שם הפועל'}),false);
});
