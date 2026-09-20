const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = require('../PeninaPlus-vocab-builder/offline-study-cards');
const card = { n: 1, term: 'סוס', english: 'horse', hebrew: 'בעל חיים' };
const saved = { term: card.term, definition: card.english, answers: ['donkey', 'camel', 'goat', 'sheep'] };
const ready = () => ({ ...card, alternativeAnswers: { english: structuredClone(saved) } });

test('Only complete, current teacher answers unlock games; invalid or stale languages stay unavailable', () => {
    assert.equal(app.practiceRows([card], 'english').length, 0);
    assert.equal(app.practiceRows([ready()], 'english').length, 1);
    assert.equal(app.practiceRows([ready()], 'hebrew').length, 0);
    for (const mutate of [
        c => { c.term = 'פרה'; }, c => { c.english = 'cow'; },
        c => { c.alternativeAnswers.english.answers.pop(); },
        c => { c.alternativeAnswers.english.answers[0] = ''; },
        c => { c.alternativeAnswers.english.answers[0] = 'horse'; },
        c => { c.alternativeAnswers.english.answers[0] = 'camel'; },
        c => { c.alternativeAnswers.english.answers[0] = 'חמור'; }
    ]) {
        const changed = ready(); mutate(changed);
        assert.equal(app.practiceRows([changed], 'english').length, 0);
        assert(!app.makeApp('Test', [changed]).includes('id="gamify"'));
    }
    const hebrew = { ...card, alternativeAnswers: { hebrew: { term: card.term, definition: card.hebrew, answers: ['אבן', 'כיסא', 'שולחן', 'בית'] } } };
    assert.equal(app.practiceRows([hebrew], 'hebrew').length, 1);
    const html = app.makeApp('Test', [ready(), hebrew]);
    assert(html.includes('id="gamify"'));
    assert(html.includes('data-game="quiz"') && html.includes('data-game="lines"') && html.includes('data-game="cards"'));
});

test('Teacher export and card conversion preserve alternatives through standalone HTML safely', () => {
    const source = fs.readFileSync(path.join(__dirname, '../PeninaPlus-vocab-builder/index.html'), 'utf8');
    const code = source.slice(source.indexOf('function getWorkbookExportRows()'), source.indexOf('function isNoGenerationMarker('));
    const context = { generatedRows: [{ item: { hebrew: card.term, english: card.english }, alternativeAnswers: ready().alternativeAnswers }],
        syncGeneratedRowFromDom() {}, highlightHebrewContextRuns() { return []; }, highlightModernHebrewContextRuns() { return []; }, highlightEnglishContextRuns() { return []; } };
    vm.createContext(context); vm.runInContext(code, context);
    const cards = app.toCards(context.getWorkbookExportRows());
    assert.equal(app.practiceRows(cards, 'english').length, 1);
    cards[0].alternativeAnswers.english.answers[0] = 'donkey </script><script>alert(1)</script>';
    const html = app.makeApp('Test', cards);
    assert(!html.includes('donkey </script>'));
    const savedData = JSON.parse(html.match(/<script id="peninaCardData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(app.practiceRows(savedData, 'english').length, 1);
    assert.equal((html.match(/<script>/g) || []).length, 2);
});

test('Student library detects teacher-created games from published data, hides legacy sets, and opens rebuilt games', async () => {
    const pathname = 'vocabulary-cards/sixth/date--'+Buffer.from('Review').toString('base64url')+'.html';
    let html = app.makeApp('Review', [ready()]);
    const blob = { pathname, url: 'https://storage.example/set', uploadedAt: '2026-09-14' };
    const context = { module: { exports: {} }, Buffer, console,
        fetch: async () => ({ok:true,text:async()=>html}),
        require: name => {
            if (name === '@vercel/blob') return {list:async()=>({blobs:[blob],hasMore:false})};
            if (name.includes('lib/vocabulary-pages')) return {getPage:async()=>({id:'sixth'}),publicPage:p=>p};
            if (name.includes('offline-study-cards')) return app;
            return {};
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/flashcard-sets.js'),'utf8'),context);
    async function request(query) {
        const res = {setHeader(){},status(code){this.code=code;return this},json(data){this.body=data},send(data){this.body=data}};
        await context.module.exports({method:'GET',query:{grade:'sixth',...query}},res);return res;
    }
    assert.equal((await request({})).body.sets[0].hasGames,true);
    assert(!(await request({view:pathname})).body.includes('id="gamesDialog"'));
    const games = await request({games:'1'});
    assert.equal(games.code,200);
    assert(games.body.includes('id="gamesDialog"'));
    assert(games.body.includes('2026-09-13')); // midnight UTC is the prior New York date
    assert(games.body.includes(pathname));
    html = app.makeApp('Review',[card]);
    assert.equal((await request({})).body.sets[0].hasGames,false);
    html = 'invalid stored data';
    assert.equal((await request({})).body.sets[0].hasGames,false);
});

test('Matching rounds always reserve three decoys, including sets whose alternatives are other correct definitions',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../PeninaPlus-vocab-builder/offline-study-cards.js'),'utf8');
    const start=source.indexOf('            let group = rows.slice(offset, offset + 6);');
    const code=source.slice(start,source.indexOf('            const makeTile',start));
    for(const count of [5,6,8,12]){
        const rows=Array.from({length:count},(_,id)=>({id,term:'term '+id,definition:'definition '+id,answers:[1,2,3,4].map(n=>'definition '+((id+n)%count))}));
        let offset=0;const covered=[];
        while(offset<count){
            const ctx={rows,offset,shuffle:values=>values.slice(),matchingCount:0};
            vm.createContext(ctx);vm.runInContext(code+';this.result={group,extras};',ctx);
            const {group,extras}=ctx.result;
            assert.equal(extras.length,3);assert.equal(ctx.matchingCount,group.length);
            assert(extras.every(extra=>!group.some(row=>row.definition===extra.definition)));
            covered.push(...group.map(row=>row.id));offset+=group.length;
        }
        assert.deepEqual(covered,rows.map(row=>row.id));
    }
});
