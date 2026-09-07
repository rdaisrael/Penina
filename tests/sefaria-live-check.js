// Optional integration check: node tests/sefaria-live-check.js
// Makes real requests to Sefaria; does not call a paid AI service or publish changes.
const assert = require('node:assert/strict');
const { createSearch } = require('./helpers/sefaria-harness');
const proxy = require('../api/sefaria-search');
const requests = [];
const fetchImpl = async (url, options) => {
    requests.push(url === '/api/sefaria-search' ? {url, ...JSON.parse(options.body)} : {url:decodeURIComponent(url)});
    if (url !== '/api/sefaria-search') return fetch(url, options);
    const result = {};
    await proxy({method:'POST',body:JSON.parse(options.body)}, {
        status(code) {result.status=code;return this},
        json(data) {result.data=data;return this}
    });
    return {ok:result.status===200,json:async()=>result.data};
};
const { search } = createSearch(fetchImpl, async () => {throw new Error('AI validation is outside this live Sefaria check')});
const target=(corpus,book,scope,value)=>[{corpus,book,scope,value}];
const cases = [
    ['Tanakh selected chapter','אור','Tanakh',target('Tanakh','בראשית','chapter','1'),/^Genesis 1(?:$|:)/],
    ['Tanakh book fallback','מבול','Tanakh',target('Tanakh','בראשית','chapter','1'),/^Genesis /],
    ['Tanakh corpus fallback','צפרדעים','Tanakh',target('Tanakh','בראשית','chapter','1'),/^(Exodus|Psalms) /],
    ['Talmud selected daf','מאימתי','Talmud',target('Talmud','ברכות','daf','2a'),/^Berakhot 2a(?:$|:)/],
    ['Talmud selected second perek','היה קורא','Talmud',target('Talmud','ברכות','perek','1'),/^Berakhot 13a(?:$|:)/],
    ['Talmud masechta fallback','מאימתי קורין','Talmud',target('Talmud','ברכות','perek','1'),/^Berakhot /],
    ['Tanakh absent word','זזזזזזזזזזזזז','Tanakh',[],null],
    ['Talmud absent word','זזזזזזזזזזזזז','Talmud',[],null]
];
(async()=>{
    for(const [name,word,corpus,targets,expected] of cases){
        const before=requests.length;
        const found=await search(word,corpus,targets);
        if(expected) {
            assert(found, name+': no quote found');
            assert.match(found.ref,expected,name);
            assert(found.he,name+': missing Hebrew');
        } else assert.equal(found,null,name);
        const used=requests.slice(before);
        console.log(JSON.stringify({name,ref:found?.ref||null,hasSourceEnglish:!!found?.sourceEnglish,requests:used.length,scopes:used.filter(r=>r.filters).map(r=>r.filters)}));
    }
    console.log('All 8 live Sefaria integration checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
