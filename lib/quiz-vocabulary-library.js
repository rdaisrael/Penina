'use strict';
const {list}=require('@vercel/blob');
const {listPages}=require('./vocabulary-pages');
const {practiceRows}=require('../PeninaPlus-vocab-builder/offline-study-cards');
const {listKnowledge,readKnowledge}=require('./study-sets');
const {validateRows}=require('./quiz-vocabulary');
const key=value=>value.normalize('NFC').trim().toLowerCase();
const clean=value=>typeof value==='string' && value.trim().toUpperCase()!=='N'?value.trim():'';
function fail(message,status=400){throw Object.assign(Error(message),{status});}
async function library(user){
    if(!Number.isSafeInteger(user.userId)||user.userId<1)fail('Sign in with your registered teacher account.',403);
    const sets=[];
    for(const page of await listPages(user.userId)){
        let cursor;
        do{
            const result=await list({prefix:`vocabulary-cards/${page.id}/`,cursor,limit:1000});
            for(const blob of result.blobs.filter(b=>b.pathname.startsWith(`vocabulary-cards/${page.id}/`)&&b.pathname.endsWith('.html'))){
                const encoded=blob.pathname.split('/').pop().replace(/\.html$/,'').split('--').slice(1).join('--');
                sets.push({pathname:blob.pathname,title:Buffer.from(encoded,'base64url').toString('utf8')||'Vocabulary list',pageName:page.name,url:blob.url});
            }
            cursor=result.hasMore?result.cursor:undefined;
        }while(cursor);
        for(const blob of await listKnowledge(list,page.id)){const data=await readKnowledge(blob,fetch);sets.push({pathname:blob.pathname,title:data.title,pageName:page.name,kind:'knowledge',url:blob.url,cards:data.cards});}
    }
    return sets;
}
function mergeCards(groups,knowledgeLanguage='english'){
    const rows=[],byWord=new Map(),knowledgeIds=new Set(),conflicts=[],warnings=[];
    for(const {cards,title} of groups){
        const valid=new Map(['english','hebrew'].map(language=>[language,new Map(practiceRows(cards,language).map(r=>[r.id,r.answers]))]));
        cards.forEach((card,index)=>{
            if(card.kind==='knowledge'){
                const id=card.sourceId || JSON.stringify([card.term,card.english,card.picture]);
                if(knowledgeIds.has(id))return;
                knowledgeIds.add(id);
                const sets=Object.fromEntries(['english','hebrew'].map(lang=>[lang,valid.get(lang).get(index)||[]]));
                if(!sets[knowledgeLanguage].length)warnings.push(`${title}: ${card.term} has no valid saved ${knowledgeLanguage} distractors. Fill or generate them before creating choice questions.`);
                rows.push({kind:'knowledge',sourceId:id,word:card.term,definition:card.english,picture:card.picture,knowledgeLanguage,knowledgeDistractors:sets,definitionDistractors:sets[knowledgeLanguage],wordDistractors:[]});return;
            }
            const word=clean(card.term),language=/[א-ת]/u.test(word)?'english':'hebrew',definition=clean(card[language]);
            if(!word||!definition){warnings.push(`${title}: skipped row ${index+1} because its term or opposite-language definition is missing.`);return;}
            const incoming=valid.get(language).get(index)||[];
            let entry=byWord.get(key(word));
            if(!entry){entry={index:rows.length,definitions:[definition]};byWord.set(key(word),entry);rows.push({word,definition,definitionDistractors:[],wordDistractors:[]});}
            if(!entry.definitions.some(d=>key(d)===key(definition)))entry.definitions.push(definition);
            const row=rows[entry.index];
            for(const answer of incoming)if(!row.definitionDistractors.some(d=>key(d)===key(answer)))row.definitionDistractors.push(answer);
            if(!incoming.length && card.alternativeAnswers?.[language])warnings.push(`${title}: saved distractors for ${word} no longer match the term and definition; generate missing distractors after loading.`);
        });
    }
    for(const entry of byWord.values()){
        const row=rows[entry.index];
        row.definitionDistractors=row.definitionDistractors.filter(d=>!entry.definitions.some(a=>key(a)===key(d)));
        if(row.definitionDistractors.length>10)fail(`The combined distractors for ${row.word} exceed 10. Select fewer lists.`);
        if(entry.definitions.length>1)conflicts.push({index:entry.index,word:row.word,definitions:entry.definitions});
    }
    return {rows:validateRows(rows,1),conflicts,warnings};
}
async function handle(user,body){
    const sets=await library(user);
    if(body.action==='vocabulary-library')return {sets:sets.map(({url,cards,...set})=>set)};
    if(!Array.isArray(body.pathnames)||!body.pathnames.length||body.pathnames.length>50||new Set(body.pathnames).size!==body.pathnames.length)fail('Choose 1–50 saved wordlists.');
    const selected=body.pathnames.map(p=>sets.find(s=>s.pathname===p));
    if(selected.some(s=>!s))fail('A selected list is unavailable or does not belong to your account. Refresh your wordlists.',403);
    const language=body.language??'english';
    if(!['english','hebrew'].includes(language))fail('Choose English or Hebrew knowledge distractors.');
    const groups=[];
    for(const set of selected){
        if(set.kind==='knowledge'){groups.push({title:set.title,cards:set.cards});continue;}
        const response=await fetch(set.url,{cache:'no-store'});
        if(!response.ok)fail('A saved wordlist could not be loaded. Try again.',503);
        const html=await response.text();
        const match=html.match(/<script id="peninaCardData" type="application\/json">([\s\S]*?)<\/script>/)||html.match(/const originalCards=(\[[\s\S]*?\]);let cards=/);
        if(!match)fail(`Saved vocabulary data is unavailable for ${set.title}.`);
        const cards=JSON.parse(match[1]);
        if(!Array.isArray(cards))fail('Saved vocabulary data is invalid.');
        groups.push({title:set.title,cards});
    }
    return mergeCards(groups,language);
}
module.exports={handle,mergeCards};
