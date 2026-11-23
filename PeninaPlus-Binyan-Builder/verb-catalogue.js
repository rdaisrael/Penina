(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./verb-data'));
    else root.BinyanCatalogue=factory(root.BinyanVerbData);
})(typeof globalThis!=='undefined'?globalThis:this,function(data){
    'use strict';
    const normalize=value=>String(value).normalize('NFD').replace(/[^א-ת]/g,'').replace(/[ךםןףץ]/g,c=>({'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'}[c]));
    // Normalize only equivalent pointed spellings, never the vowel quality or
    // shin/sin distinction. Thus a grammatical-looking but wrong form fails.
    function pointedKey(value){
        return String(value).normalize('NFD').replace(/[\u0591-\u05AF\u05BD]/g,'').replace(/\u05C7/g,'\u05B8').replace(/\u05BA/g,'\u05B9')
            .replace(/([א-ת][\u05BC\u05C1\u05C2]*)וֹ/g,'$1\u05B9')
            .replace(/([א-ת][\u05BC\u05C1\u05C2]*)וּ/g,'$1\u05BB')
            .replace(/([א-ת]\u05B4[\u05BC\u05C1\u05C2]*)י(?![\u05B0-\u05BC\u05C1\u05C2])/g,'$1').normalize('NFD');
    }
    const index=new Map();
    for(const entry of data.entries){
        const key=JSON.stringify([entry.root,entry.binyan]);
        if(!index.has(key))index.set(key,[]);
        index.get(key).push(entry);
    }
    function entries(root,pair,kind){
        const [group,tense]=pair.split('|'),binyan=group.split(' ')[0];
        return (index.get(JSON.stringify([normalize(root),binyan]))||[]).filter(entry=>{
            const pattern=entry.patterns[tense];
            return pattern&&(!kind||pattern.kind===kind)&&(group.endsWith('כל הגזרות')||pattern.group===group);
        });
    }
    const entryFor=(root,pair,kind='standard')=>entries(root,pair,kind)[0];
    const answers=(root,pair,person,kind='standard')=>entryFor(root,pair,kind)?.forms[pair.split('|')[1]]?.[person]||[];
    const accepts=(root,pair,person,answer,kind='standard')=>typeof answer==='string'&&answers(root,pair,person,kind).some(expected=>pointedKey(expected)===pointedKey(answer));
    function describe(root,pair){
        const standard=entryFor(root,pair,'standard'),exception=entryFor(root,pair,'exception');
        return {root,standard:!!standard,exception:!!exception,unverified:!standard&&!exception,
            reason:exception?.patterns[pair.split('|')[1]].reason||'',source:(standard||exception)?.source};
    }
    function reference(root,pair,kind='standard'){
        const entry=entryFor(root,pair,kind);if(!entry)return null;
        const tense=pair.split('|')[1];
        return {root:entry.root,lemma:entry.word,meaning:tense==='שם פעולה'?`action noun for: ${entry.meaning}`:entry.meaning,
            forms:entry.forms[tense],pattern:entry.patterns[tense],source:entry.source};
    }
    return {entryFor,entries,answers,accepts,describe,reference,pointedKey,metadata:{version:data.version,source:data.source,snapshot:data.snapshot,license:data.license,entries:data.entries.length}};
});
