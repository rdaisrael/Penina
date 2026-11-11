'use strict';
const {normalizeDeck}=require('../PeninaPlus-knowledge-builder/cards');
// Adapts question/answer cards without changing the published source or its choices.
function knowledgeCards(input,pathname='') {
    const deck=normalizeDeck(input);
    return {title:deck.title,cards:deck.cards.map(card=>({
        kind:'knowledge',sourceId:pathname+'#'+card.id,term:card.question,
        english:card.answer,hebrew:card.answer,picture:card.picture,
        alternativeAnswers:Object.fromEntries(Object.entries(card.distractors).map(([language,answers])=>[language,{term:card.question,definition:card.answer,answers}]))
    }))};
}
async function listKnowledge(list,grade) {
    const prefix=`knowledge-cards/${grade}/`,blobs=[];let cursor;
    do {const page=await list({prefix,cursor,limit:1000});blobs.push(...page.blobs.filter(b=>b.pathname.startsWith(prefix)&&b.pathname.endsWith('.json')));cursor=page.hasMore?page.cursor:undefined;}while(cursor);
    return blobs;
}
async function readKnowledge(blob,fetcher=fetch) {
    const response=await fetcher(blob.url,{cache:'no-store'});
    if(!response.ok)throw Error('A knowledge list could not be loaded. Try again.');
    return knowledgeCards(JSON.parse(await response.text()),blob.pathname);
}
module.exports={knowledgeCards,listKnowledge,readKnowledge};
