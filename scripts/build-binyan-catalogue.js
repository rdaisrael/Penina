'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {classify,models}=require('../lib/binyan-patterns');
const binyanCodes={pa:'פעל',pi:'פיעל',hif:'הפעיל',hit:'התפעל',nif:'נפעל',pu:'פועל',huf:'הופעל',po:'פיעל',hitpo:'התפעל',poal:'פועל'};
const tenseCodes={past:'עבר',present:'הווה',future:'עתיד',imperative:'ציווי'};
const personal=['first_sg','second_m_sg','second_f_sg','third_m_sg','third_f_sg','first_pl','second_m_pl','second_f_pl','third_m_pl','third_f_pl'];
const persons=tense=>tense==='הווה'?['masculine_singular','feminine_singular','masculine_plural','feminine_plural']:
    ['שם הפועל','שם פעולה'].includes(tense)?['form']:tense==='ציווי'?['second_m_sg','second_f_sg','second_m_pl','second_f_pl']:personal;
const normalize=value=>String(value).normalize('NFD').replace(/[^א-ת]/g,'').replace(/[ךםןףץ]/g,c=>({'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'}[c]));
const pointed=value=>typeof value==='string'&&/^[א-ת\u05B0-\u05BC\u05C1\u05C2\u05C7]+$/.test(value)&&(/[\u05B0-\u05BB]/.test(value)||/וּ/.test(value));
const excluded=new Set(['archaic','obsolete','dated','rare','Biblical','Medieval','poetic','literary','vulgar','offensive','derogatory','form-of','alt-of']);
// These dictionary entries use an explicit irregular table without he-conj's
// root parameter. Supply only the identity; every form still comes from that table.
const explicitTables={'היה':['פעל','היה'],'חי':['פעל','חיה'],'יכול':['פעל','יכל'],'נמס':['נפעל','מסס'],'החיה':['הפעיל','חיה'],'הטיל':['הפעיל','טול']};
function suitableSense(sense){return !(sense.tags||[]).some(tag=>excluded.has(tag))&&!sense.form_of&&!sense.alt_of&&sense.glosses?.length;}
function formPersons(tags,tense){
    if(['שם הפועל','שם פעולה'].includes(tense))return ['form'];
    const gender=['masculine','feminine'].filter(tag=>tags.includes(tag));
    const numbers=['singular','plural'].filter(tag=>tags.includes(tag));
    if(tense==='הווה')return gender.flatMap(g=>numbers.map(n=>`${g}_${n}`));
    const people=tense==='ציווי'?['second']:['first','second','third'].filter(p=>tags.includes(`${p}-person`));
    return people.flatMap(p=>numbers.flatMap(n=>p==='first'?[`first_${n==='singular'?'sg':'pl'}`]:gender.map(g=>`${p}_${g[0]}_${n==='singular'?'sg':'pl'}`)));
}
function extract(entry){
    if(entry.pos!=='verb')return null;
    const senses=(entry.senses||[]).filter(suitableSense);
    if(!senses.length)return null;
    const templates=(entry.inflection_templates||[]).filter(t=>t.name==='he-conj'&&binyanCodes[t.args?.['1']]);
    const identities=[...new Set(templates.map(t=>JSON.stringify([binyanCodes[t.args['1']],normalize(t.args['2'])])))];
    if(!identities.length&&explicitTables[entry.word]&&entry.inflection_templates?.some(t=>t.name==='he-verb-conjugation'))identities.push(JSON.stringify(explicitTables[entry.word]));
    if(identities.length!==1)return null;
    let [binyan,root]=JSON.parse(identities[0]);
    if(root.length<2||root.length>4)return null;
    // Wiktionary uses historical initial waw for several modern initial-yod roots.
    if(['הפעיל','הופעל'].includes(binyan)&&root.startsWith('ו'))root='י'+root.slice(1);
    if(binyan==='פיעל'&&root==='לבש')return null;
    const forms={};
    for(const form of entry.forms||[]){
        if(form.source!=='conjugation'||!pointed(form.form))continue;
        const tags=form.tags||[];
        if(tags.some(t=>excluded.has(t)||t==='negative'))continue;
        let tense=Object.entries(tenseCodes).find(([tag])=>tags.includes(tag))?.[1];
        if(tags.includes('noun-from-verb'))tense='שם פעולה';
        // This snapshot's extractor labels the infinitive header this way.
        // Require the conjugation table, the sole header tag and an initial lamed.
        if(tags.length===1&&tags[0]==='error-unrecognized-form'&&form.form.startsWith('ל'))tense='שם הפועל';
        if(!tense||(['פועל','הופעל'].includes(binyan)&&!['עבר','הווה','עתיד'].includes(tense)))continue;
        for(const person of formPersons(tags,tense)){
            const answers=((forms[tense]||={})[person]||=[]),answer=form.form.normalize('NFC');
            if(!answers.some(x=>x.normalize('NFD')===answer.normalize('NFD')))answers.push(answer);
        }
    }
    // Classroom convention already used by the builder: shared modern plurals.
    for(const tense of ['עתיד','ציווי'])for(const person of ['second','third']){
        if(forms[tense]?.[`${person}_m_pl`])forms[tense][`${person}_f_pl`]=[...forms[tense][`${person}_m_pl`]];
    }
    for(const tense of Object.keys(forms)){
        if(persons(tense).some(person=>!forms[tense][person]?.length))delete forms[tense];
        // Use the first listed pointed form in each cell. Secondary variants
        // (often literary feminine forms) need their own review before inclusion.
        else forms[tense]=Object.fromEntries(persons(tense).map(person=>[person,[forms[tense][person][0]]]));
    }
    // The source explicitly parenthesizes היה's present forms. They are not a
    // substitute for the ordinary modern zero-copula and remain unverified here.
    if(entry.word==='היה')delete forms['הווה'];
    if(!Object.keys(forms).length)return null;
    return {root,binyan,word:entry.word,meaning:senses[0].glosses.at(-1).replace(/^to /i,'').replace(/\.$/,'').slice(0,150),
        source:`https://en.wiktionary.org/wiki/${encodeURIComponent(entry.word)}#Hebrew`,forms};
}
function build(input,output){
    const source=fs.readFileSync(input,'utf8');
    const entries=source.split('\n').filter(Boolean).map(line=>extract(JSON.parse(line))).filter(Boolean);
    // Do not combine homonymous lexemes or union conflicting paradigms. Each
    // keeps its own source, meaning, forms and per-tense classification.
    const unique=[...new Map(entries.map(entry=>[JSON.stringify([entry.root,entry.binyan,entry.word,entry.forms]),entry])).values()];
    for(const [group,[binyan,root]] of Object.entries(models))if(!unique.some(entry=>entry.root===root&&entry.binyan===binyan))throw Error(`Missing pattern model: ${group} ${root}`);
    for(const entry of unique)entry.patterns=Object.fromEntries(Object.keys(entry.forms).map(tense=>[tense,classify(entry,tense,unique)]));
    const data={version:1,source:'https://kaikki.org/dictionary/Hebrew/kaikki.org-dictionary-Hebrew.jsonl',
        snapshot:'2026-10-01 Wiktionary dump; extracted 2026-10-30',sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),
        license:'CC-BY-SA-4.0',attribution:'Wiktionary contributors; extracted by Kaikki.org / Wiktextract',entries:unique};
    fs.writeFileSync(output,'// Dictionary data adapted from Wiktionary via Kaikki.org. CC BY-SA 4.0. See VERB-DATA-LICENSE.txt.\n'+
        '(function(root,data){if(typeof module===\'object\'&&module.exports)module.exports=data;else root.BinyanVerbData=data;})(typeof globalThis!==\'undefined\'?globalThis:this,\n'+JSON.stringify(data)+'\n);\n');
    const counts={};
    for(const entry of unique)for(const [tense,pattern] of Object.entries(entry.patterns)){
        const key=`${entry.binyan}|${tense}`;const count=counts[key]||={standard:0,exception:0};count[pattern.kind]++;
    }
    return {entries:unique.length,counts,sourceSha256:data.sourceSha256};
}
if(require.main===module){
    if(!process.argv[2])throw Error('Usage: node scripts/build-binyan-catalogue.js /path/to/kaikki.org-dictionary-Hebrew.jsonl');
    console.log(JSON.stringify(build(process.argv[2],path.join(__dirname,'../PeninaPlus-Binyan-Builder/verb-data.js')),null,2));
}
module.exports={build,extract,persons};
