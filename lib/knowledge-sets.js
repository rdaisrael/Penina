'use strict';
const storage=require('@vercel/blob');
const pageStore=require('./vocabulary-pages');
const {requireApps}=require('./teacher-apps');
const {normalizeDeck,practiceCards}=require('../PeninaPlus-knowledge-builder/cards');
const {makeStudentApp}=require('./knowledge-publication');
const {makeSheet}=require('../PeninaPlus-vocab-builder/vocabulary-sheets');
const {generate}=require('./knowledge-distractors');
const {randomUUID}=require('node:crypto');
const MAX_BYTES=3500000;
function createHandler(overrides={}) {
    const deps={storage,pageStore,requireApps,makeStudentApp,makeSheet,generate,fetch:(...args)=>fetch(...args),...overrides};
    async function blobsFor(grade) {
        const blobs=[];let cursor;
        do {const result=await deps.storage.list({prefix:`knowledge-cards/${grade}/`,cursor,limit:1000});blobs.push(...result.blobs.filter(blob=>blob.pathname.endsWith('.json')));cursor=result.hasMore?result.cursor:undefined;}while(cursor);
        return blobs;
    }
    async function readDeck(blob) {
        const result=await deps.fetch(blob.url,{cache:'no-store'});
        if(!result.ok)throw Error('Stored set unavailable.');
        return normalizeDeck(await result.json());
    }
    function formatSet(blob,grade,deck) {
        const url=`/api/flashcard-sets?kind=knowledge&grade=${encodeURIComponent(grade)}&view=${encodeURIComponent(blob.pathname)}`;
        return {kind:'knowledge',title:deck.title,pathname:blob.pathname,publishedAt:blob.uploadedAt,url,
            downloadUrl:url+'&download=1',printUrl:url+'#print',sheetUrl:url+'&sheet=1',
            sheetDownloadUrl:url+'&sheet=1&action=download',sheetPrintUrl:url+'&sheet=1&action=print',practiceUrl:url+'#quiz',
            hasPractice:['english','hebrew'].some(language=>practiceCards(deck,language).length>0),cardCount:deck.cards.length};
    }
    return async function handle(req,res) {
        res.setHeader('Cache-Control','no-store');
        const send=(status,body)=>res.status(status).json(body);
        try {
            if(!['GET','POST','DELETE'].includes(req.method))return send(405,{error:'Method Not Allowed'});
            if(req.method!=='GET') {
                await deps.requireApps(req,['vocabulary']);
                if(req.headers?.origin!=='https://www.penina-hebrew.org')return send(403,{error:'Open Knowledge Builder on Penina to make changes.'});
            }
            if(req.method==='POST' && req.body?.action==='generate-distractors')return send(200,await deps.generate(req.body));
            const grade=String(req.query?.grade || req.body?.grade || '').toLowerCase();
            const page=await deps.pageStore.getPage(grade);
            if(!page)return send(400,{error:'Choose an existing class webpage.'});
            if(req.method!=='GET') {
                const denied=deps.pageStore.authorizePage(req,page);
                if(denied)return send(denied.status,{error:denied.error});
            }
            if(req.method==='GET') {
                const blobs=await blobsFor(grade);
                if(req.query?.view) {
                    const blob=blobs.find(value=>value.pathname===req.query.view);
                    if(!blob)return send(404,{error:'This knowledge set could not be found.'});
                    const deck=await readDeck(blob);
                    res.setHeader('Content-Type','text/html; charset=utf-8');
                    if(req.query.sheet==='1')return res.status(200).send(deps.makeSheet(deck.title,deck.cards,{kind:'knowledge',context:deck.cards.some(card=>card.additionalInformation)}));
                    res.setHeader('Content-Disposition',`${req.query.download==='1'?'attachment':'inline'}; filename="knowledge-flashcards.html"`);
                    return res.status(200).send(deps.makeStudentApp(deck,{homeUrl:page.url}));
                }
                const sets=[];
                for(let offset=0;offset<blobs.length;offset+=8) {
                    sets.push(...await Promise.all(blobs.slice(offset,offset+8).map(async blob=>formatSet(blob,grade,await readDeck(blob)))));
                }
                sets.sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
                return send(200,{page:deps.pageStore.publicPage(page),sets});
            }
            if(req.method==='DELETE') {
                const paths=req.body?.pathnames;
                if(!Array.isArray(paths)||!paths.length||paths.length>100||new Set(paths).size!==paths.length)return send(400,{error:'Select valid knowledge sets to remove.'});
                const existing=await blobsFor(grade),chosen=paths.map(value=>existing.find(blob=>blob.pathname===value));
                if(chosen.some(value=>!value))return send(404,{error:'A selected knowledge set could not be found on this class page.'});
                await deps.storage.del(chosen.map(blob=>blob.url));return send(200,{removed:paths});
            }
            if(req.body?.action!=='publish')return send(400,{error:'Choose a valid Knowledge Builder action.'});
            if(Buffer.byteLength(JSON.stringify(req.body),'utf8')>MAX_BYTES)return send(413,{error:'This set is too large to publish. Use smaller pictures or split it into smaller sets.'});
            let deck;try{deck=normalizeDeck(req.body.deck);}catch(error){return send(400,{error:error.message});}
            if(!deck.cards.length || !req.body.deck.title?.trim())return send(400,{error:'Enter a title and add at least one question and answer before publishing.'});
            const stamp=new Date().toISOString().replace(/[:.]/g,'-');
            const pathname=`knowledge-cards/${grade}/${stamp}-${randomUUID()}.json`;
            const blob=await deps.storage.put(pathname,JSON.stringify(deck),{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});
            return send(201,{page:deps.pageStore.publicPage(page),set:formatSet(blob,grade,deck)});
        } catch(error) {
            return send(error.status || 503,{error:error.status?error.message:'Knowledge sets could not be saved or loaded. Please try again.'});
        }
    };
}
module.exports={createHandler,handle:createHandler()};
