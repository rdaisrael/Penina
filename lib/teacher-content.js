'use strict';
const crypto=require('crypto');
const {list,get,del}=require('@vercel/blob');
const account=()=>require('./quiz-account');
async function blobs(prefix) {
    const result=[];let cursor;
    do {const page=await list({prefix,cursor,limit:1000});result.push(...page.blobs);cursor=page.hasMore?page.cursor:undefined;}while(cursor);
    return result;
}
async function record(blob) {
    const response=await get(blob.url,{access:'public',useCache:false});
    if(!response || response.statusCode!==200)throw Error('Content could not be read.');
    return account().unseal(await new Response(response.stream).text());
}
async function remove(items) {
    for(let i=0;i<items.length;i+=100)await del(items.slice(i,i+100).map(b=>b.url));
}
async function deleteOwnedQuizzes(teacher) {
    if(!Number.isSafeInteger(teacher.userId) || teacher.userId<2)throw Error('Choose a non-administrator account.');
    const owners=new Set(['email:'+teacher.userId]);
    // Keep connection records until cleanup completes so retries can resolve every owner.
    const connections=[];
    for(const blob of await blobs('quiz-google/teachers/')) {
        const user=await record(blob);
        if(user.email?.toLowerCase()===teacher.email.toLowerCase()) {
            owners.add(blob.pathname.slice('quiz-google/teachers/'.length,-4));connections.push(blob);
        }
    }
    const quizzes=new Map(),drafts=[];
    for(const owner of owners) {
        const prefix='quiz-builder/teachers/'+crypto.createHash('sha256').update(owner).digest('hex')+'/';
        for(const blob of await blobs(prefix)) {
            const quiz=await record(blob);
            if(!owners.has(quiz.owner))throw Error('Quiz ownership changed.');
            quizzes.set(quiz.id,quiz);drafts.push(blob);
        }
    }
    const published=[];
    for(const blob of await blobs('quiz-builder/published/')) {
        const quiz=await record(blob);
        if(owners.has(quiz.owner)){quizzes.set(quiz.id,quiz);published.push(blob);}
    }
    for(const id of quizzes.keys()) {
        if(!/^custom-[a-f0-9]{32}$/.test(id))throw Error('Invalid saved quiz.');
        for(const prefix of ['quiz-builder/points/','quiz-submissions/','quiz-corrections/','quiz-attempts/','quiz-practice/','quiz-progress/'])await remove(await blobs(prefix+id+'/'));
    }
    for(const blob of await blobs('quiz-google/classes/')) {
        const assignment=await record(blob);
        if(!owners.has(assignment.owner))continue;
        const id=blob.pathname.slice('quiz-google/classes/'.length,-4);
        await remove((await blobs('quiz-google/assignment-claims/'+id+'.txt')).filter(b=>b.pathname==='quiz-google/assignment-claims/'+id+'.txt'));
        await remove([blob]);
    }
    for(const owner of owners)await remove(await blobs('quiz-google/assignment-archives/'+encodeURIComponent(owner)+'/'));
    // Ownership manifests are removed last; interrupted cleanup remains discoverable.
    await remove(published);await remove(drafts);await remove(connections);
}
module.exports={deleteOwnedQuizzes};
