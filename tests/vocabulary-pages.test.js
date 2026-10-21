const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function server() {
    const blobs = new Map();
    const storage = {
        async list({ prefix, cursor }) {
            const all = [...blobs.values()].filter(blob => blob.pathname.startsWith(prefix));
            const offset = Number(cursor || 0);
            return { blobs: all.slice(offset, offset + 1), hasMore: offset + 1 < all.length, cursor: String(offset + 1) };
        },
        async put(pathname, content, options) {
            if (blobs.has(pathname) && !options.allowOverwrite) throw new Error('Blob already exists');
            const blob = { pathname, url: 'https://storage.example/' + pathname, uploadedAt: new Date().toISOString(), content };
            blobs.set(pathname, blob);
            return blob;
        },
        async del(urls) {
            for (const [id, blob] of blobs) if (urls.includes(blob.url)) blobs.delete(id);
        }
    };
    const env = { VOCABULARY_PAGE_CREATE_PASSWORD: 'test-admin-password', BLOB_READ_WRITE_TOKEN: 'test-storage-secret', CARD_PUBLISH_KEY_SIXTH: 'legacy-password' };
    const context = {
        Buffer, console, process: { env },
        fetch: async url => {
            const blob = [...blobs.values()].find(item => item.url === url);
            return { ok: !!blob, json: async () => JSON.parse(blob.content), text: async () => blob.content };
        },
        require(name) {
            if (name === 'crypto') return require('node:crypto');
            if (name === '@vercel/blob') return storage;
            if (name === '../lib/quiz-teachers') return load('lib/quiz-teachers.js');
            if (name === '../lib/quiz-account') return {session: req => ({role:'teacher',userId:Number(req.headers.cookie.split('=').pop())})};
            if (name === '../lib/vocabulary-pages') return load('lib/vocabulary-pages.js');
            return require(path.join(__dirname, '../api', name));
        }
    };
    function load(file) {
        const sandbox = { ...context, module: { exports: {} } };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox);
        return sandbox.module.exports;
    }
    async function request(file, method, body = {}, query = {}, headers = {}) {
        const response = {
            headers: {}, setHeader(key, value) { this.headers[key] = value; },
            status(code) { this.code = code; return this; },
            json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; },
            send(data) { this.body = data; return this; }
        };
        await load(file)({ method, body, query, headers }, response);
        return response;
    }
    const create = body => request('api/vocabulary-pages.js', 'POST', { creationPassword: '1-AW', ...body });
    return { request, create, blobs, env };
}

test('Creation requires exactly the configured owner creation code', async () => {
    const { request, blobs } = server();
    for (const creationPassword of ['1-aw','2-AW','0-aw','001-AW','1-AW ','wrong','1-AU']) {
        assert.equal((await request('api/vocabulary-pages.js','POST',{name:'Test',password:'1-6',creationPassword})).code,401);
        assert.equal(blobs.size,0);
    }
    assert.equal((await request('api/vocabulary-pages.js','POST',{name:'Test',password:'1-6',creationPassword:'1-AW'})).code,201);
});

test('Created pages persist across requests, list alongside grades, and expose no credentials', async () => {
    const { request, create, blobs } = server();
    const created = await create({ name: '  Ninth   Grade  ', password: '1-סיסמה<&>-secret' });
    assert.equal(created.code, 201);
    assert.equal(created.body.page.name, 'Ninth Grade');
    assert.equal(created.body.page.url, '/PeninaPlus-vocab-builder/flash-cards/?page=ninth-grade');
    await create({ name: 'מילים', password: '1-another-password' });
    const listing = await request('api/vocabulary-pages.js', 'GET');
    assert.equal(listing.code, 200);
    assert.equal(listing.body.pages.length, 5);
    assert.equal(listing.headers['Cache-Control'], 'no-store');
    assert(listing.body.pages.some(page => page.id === 'sixth'));
    assert(listing.body.pages.some(page => page.id === 'ninth-grade'));
    for (const page of listing.body.pages) assert.deepEqual(Object.keys(page).sort(), ['id', 'name', 'url']);
    for (const blob of blobs.values()) {
        assert(!blob.content.includes('secret'));
        assert(!blob.content.includes('1-another-password'));
    }
});

test('Duplicate and concurrent creates cannot overwrite another page password', async () => {
    const { request, create } = server();
    const results = await Promise.all(['1-first', '1-second'].map(password => create({ name: 'My Class', password })));
    assert.deepEqual(results.map(result => result.code).sort(), [201, 409]);
    const duplicate = await create({ name: 'MY CLASS', password: '1-replacement' });
    assert.equal(duplicate.code, 409);
    const originalPassword = results[0].code === 201 ? '1-first' : '1-second';
    assert.equal((await request('api/flashcard-sets.js', 'POST', { grade: 'my-class', action: 'authenticate', password: originalPassword })).code, 200);
    assert.equal((await request('api/flashcard-sets.js', 'POST', { grade: 'my-class', action: 'authenticate', password: '1-replacement' })).code, 401);
});

test('Duplicate names ignore capitalization, extra whitespace, and Unicode variants', async () => {
    const { create, blobs } = server();
    assert.equal((await create({ name: 'My Class', password: '1-original' })).code, 201);
    for (const name of ['My Class', 'MY CLASS', '  my   class  ', 'Ｍｙ Ｃｌａｓｓ']) {
        const result = await create({ name, password: '1-replacement' });
        assert.equal(result.code, 409);
        assert.match(result.body.error, /already exists/);
        assert.equal(blobs.size, 1);
    }
    assert.equal((await create({ name: 'מילים', password: '1-original' })).code, 201);
    assert.equal((await create({ name: '  מילים  ', password: '1-replacement' })).code, 409);
    assert.equal(blobs.size, 2);
});

test('A custom page supports empty view, publishing, viewing, authentication, and deletion with its own password', async () => {
    const { request, create } = server();
    const password = '1-סיסמה-secret';
    const grade = 'ninth';
    await create({ name: 'Ninth', password });
    await create({ name: 'Tenth', password: '1-different' });
    const empty = await request('api/flashcard-sets.js', 'GET', {}, { grade });
    assert.equal(empty.code, 200);
    assert.equal(empty.body.sets.length, 0);
    assert.equal(empty.body.page.name, 'Ninth');
    assert(!JSON.stringify(empty.body).includes('passwordVerifier'));
    const html = require('../PeninaPlus-vocab-builder/offline-study-cards').makeApp('Review', [{ n: 1, term: 'מילה', english: 'Word' }]);
    const body = { grade, title: 'Review', html, password };
    assert.equal((await request('api/flashcard-sets.js', 'POST', { ...body, password: 'wrong' })).code, 401);
    const published = await request('api/flashcard-sets.js', 'POST', body);
    assert.equal(published.code, 201);
    const pathname = published.body.set.pathname;
    const listing = await request('api/flashcard-sets.js', 'GET', {}, { grade });
    assert.equal(listing.body.sets.length, 1);
    const viewed = await request('api/flashcard-sets.js', 'GET', {}, { grade, view: pathname });
    assert.equal(viewed.code, 200);
    assert(viewed.body.includes('מילה'));
    assert.equal((await request('api/flashcard-sets.js', 'GET', {}, { grade: 'tenth', view: pathname })).code, 404);
    assert.equal((await request('api/flashcard-sets.js', 'DELETE', { grade, password: '1-different', pathnames: [pathname] })).code, 401);
    assert.equal((await request('api/flashcard-sets.js', 'DELETE', { grade: 'tenth', password: '1-different', pathnames: [pathname] })).code, 400);
    assert.equal((await request('api/flashcard-sets.js', 'DELETE', { grade, password, pathnames: [pathname] })).code, 200);
    assert.equal((await request('api/flashcard-sets.js', 'GET', {}, { grade })).body.sets.length, 0);
});

test('Invalid names, missing passwords, unknown pages, and existing grade names are rejected', async () => {
    const { request, create } = server();
    for (const body of [{ name: ' ', password: '1-ok' }, { name: 'New', password: '  ' }, { name: 'a'.repeat(121), password: '1-ok' }, { name: 'New', password: 'x'.repeat(257) }]) {
        assert.equal((await create(body)).code, 400);
    }
    for (const name of ['Sixth', 'Sixth Grade Gemara Vocabulary', 'SEVENTH']) {
        assert.equal((await create({ name, password: '1-ok' })).code, 409);
    }
    for (const grade of ['unknown', '../sixth', '']) {
        assert.equal((await request('api/flashcard-sets.js', 'GET', {}, { grade })).code, 400);
    }
    assert.equal((await request('api/flashcard-sets.js', 'POST', { grade: 'sixth', action: 'authenticate' }, {}, { 'x-penina-publish-key': 'legacy-password' })).code, 200);
    assert.equal((await request('api/vocabulary-pages.js', 'DELETE')).code, 405);
});

test('Storage failures report errors without creating a successful page response', async () => {
    const { create, env, blobs } = server();
    delete env.BLOB_READ_WRITE_TOKEN;
    const result = await create({ name: 'New Page', password: '1-private-value' });
    assert.equal(result.code, 500);
    assert(!JSON.stringify(result.body).includes('1-private-value'));
    assert.equal(blobs.size, 0);
});


test('Page creation requires the creation password pattern before any page is saved', async () => {
    const { request, blobs } = server();
    for (const creationPassword of [undefined, '', 'wrong!', '1235', 1234, ['test-admin-password']]) {
        const result = await request('api/vocabulary-pages.js', 'POST', {
            name: 'Protected Page', password: '1-page-publishing-password', creationPassword
        });
        assert.equal(result.code, 401);
        assert.equal(blobs.size, 0);
        assert(!JSON.stringify(result.body).includes('test-admin-password'));
    }
    const created = await request('api/vocabulary-pages.js', 'POST', {
        name: 'Protected Page', password: '1-page-publishing-password', creationPassword: '1-AW'
    });
    assert.equal(created.code, 201);
    assert.equal(blobs.size, 1);
    assert(!JSON.stringify(created.body).includes('test-admin-password'));
    assert(![...blobs.values()][0].content.includes('test-admin-password'));
    const listing = await request('api/vocabulary-pages.js', 'GET');
    assert.equal(listing.code, 200);
    assert.equal(listing.body.pages.length, 4);
    assert.equal((await request('api/flashcard-sets.js', 'POST', {
        grade: 'protected-page', action: 'authenticate', password: 'test-admin-password'
    })).code, 401);
    assert.equal((await request('api/flashcard-sets.js', 'POST', {
        grade: 'protected-page', action: 'authenticate', password: '1-page-publishing-password'
    })).code, 200);
});

test('Game choices require the class password, persist, and remain isolated by class', async () => {
    const { request, create } = server();
    await create({ name: 'Game Class', password: '1-editing-code' });
    await create({ name: 'Other Class', password: '1-other-code' });
    const body = { grade: 'game-class', action: 'game-settings', password: '1-editing-code', disabledGames: ['quiz', 'chomp'] };
    assert.equal((await request('api/flashcard-sets.js', 'POST', { ...body, password: 'wrong' })).code, 401);
    assert.equal((await request('api/flashcard-sets.js', 'POST', { ...body, disabledGames: ['unknown'] })).code, 400);
    assert.equal((await request('api/flashcard-sets.js', 'POST', body)).code, 200);
    const listing = await request('api/flashcard-sets.js', 'GET', {}, { grade: 'game-class' });
    assert.deepEqual(listing.body.disabledGames, ['quiz', 'chomp']);
    const other = await request('api/flashcard-sets.js', 'GET', {}, { grade: 'other-class' });
    assert.deepEqual(other.body.disabledGames, []);
    const cards = [{ term: 'סוס', english: 'horse', alternativeAnswers: { english: { term: 'סוס', definition: 'horse', answers: ['cow','dog','cat','bird'] } } }];
    const html = require('../PeninaPlus-vocab-builder/offline-study-cards').makeApp('Review', cards);
    assert.equal((await request('api/flashcard-sets.js', 'POST', { grade: 'game-class', password: '1-editing-code', title: 'Review', html })).code, 201);
    const games = await request('api/flashcard-sets.js', 'GET', {}, { grade: 'game-class', games: '1' });
    assert.equal(games.code, 200);
    assert(!games.body.includes('data-game="quiz"')); assert(!games.body.includes('data-game="chomp"'));
    assert(games.body.includes('data-game="asteroids"'));
    assert.equal((await request('api/flashcard-sets.js', 'POST', { ...body, disabledGames: [] })).code, 200);
    const restored = await request('api/flashcard-sets.js', 'GET', {}, { grade: 'game-class', games: '1' });
    assert(restored.body.includes('data-game="quiz"')); assert(restored.body.includes('data-game="chomp"'));
});

test('Wordlist inclusion persists without deleting sets and preserves exercise choices', async () => {
 const {request,create}=server();await create({name:'Included Class',password:'1-code'});
 const base={grade:'included-class',password:'1-code'};
 const html=require('../PeninaPlus-vocab-builder/offline-study-cards').makeApp('Review',[{term:'סוס',english:'horse',alternativeAnswers:{english:{term:'סוס',definition:'horse',answers:['cow','dog','cat','bird']}}}]);
 await request('api/flashcard-sets.js','POST',{...base,title:'Review',html});
 let listing=await request('api/flashcard-sets.js','GET',{},base);const pathname=listing.body.sets[0].pathname;
 assert.deepEqual(listing.body.excludedWordlists,[]);
 const settings={...base,action:'wordlist-settings',excludedWordlists:[pathname]};
 assert.equal((await request('api/flashcard-sets.js','POST',{...settings,password:'wrong'})).code,401);
 assert.equal((await request('api/flashcard-sets.js','POST',{...settings,excludedWordlists:['other/class.html']})).code,400);
 await request('api/flashcard-sets.js','POST',{...base,action:'game-settings',disabledGames:['quiz']});
 assert.equal((await request('api/flashcard-sets.js','POST',settings)).code,200);
 listing=await request('api/flashcard-sets.js','GET',{},base);
 assert.equal(listing.body.sets.length,1);assert.deepEqual(listing.body.disabledGames,['quiz']);assert.deepEqual(listing.body.excludedWordlists,[pathname]);
 assert.match((await request('api/flashcard-sets.js','GET',{}, {...base,games:'1'})).body,/No games are currently available/);
 await request('api/flashcard-sets.js','POST',{...base,action:'game-settings',disabledGames:[]});
 assert.deepEqual((await request('api/flashcard-sets.js','GET',{},base)).body.excludedWordlists,[pathname]);
 await request('api/flashcard-sets.js','POST',{...settings,excludedWordlists:[]});
 assert.match((await request('api/flashcard-sets.js','GET',{}, {...base,games:'1'})).body,/data-game="quiz"/);
});

test('Signed-in teachers only receive pages belonging to their number',async()=>{
 const {create,request,env}=server();env.CARD_PUBLISH_KEY_SIXTH='1-6';
 await create({name:'David page',password:'1-mine'});await create({name:'Other teacher',password:'2-theirs'});
 const david=await request('api/vocabulary-pages.js','GET',{}, {},{cookie:'__Host-penina-quiz-session=1'});
 assert.deepEqual(david.body.pages.map(p=>p.id).sort(),['david-page','sixth']);
 const other=await request('api/vocabulary-pages.js','GET',{}, {},{cookie:'__Host-penina-quiz-session=2'});
 assert.deepEqual(other.body.pages.map(p=>p.id),['other-teacher']);
 assert.equal((await request('api/vocabulary-pages.js','POST',{name:'Wrong owner',password:'2-no',creationPassword:'1-AW'}, {},{cookie:'__Host-penina-quiz-session=1'})).code,403);
});
test('Legacy numbered pages gain ownership after successful authentication only',async()=>{
 const {create,request,blobs}=server();await create({name:'Legacy',password:'2-old'});
 const blob=blobs.get('vocabulary-pages/legacy.json');const record=JSON.parse(blob.content);delete record.ownerNumber;blob.content=JSON.stringify(record);
 await request('api/flashcard-sets.js','POST',{grade:'legacy',action:'authenticate',password:'1-wrong'});
 assert.equal(JSON.parse(blob.content).ownerNumber,undefined);
 assert.equal((await request('api/flashcard-sets.js','POST',{grade:'legacy',action:'authenticate',password:'2-old'})).code,200);
 assert.equal(JSON.parse(blobs.get(blob.pathname).content).ownerNumber,2);
});

test('An older page can be linked only with its valid password and matching signed-in number',async()=>{
 const {create,request,blobs}=server();await create({name:'Old page',password:'2-old'});
 const blob=blobs.get('vocabulary-pages/old-page.json'),record=JSON.parse(blob.content);delete record.ownerNumber;blob.content=JSON.stringify(record);
 const headers={cookie:'__Host-penina-quiz-session=2',origin:'https://www.penina-hebrew.org'};
 const body={action:'claim',pageId:'old-page',password:'2-old'};
 assert.equal((await request('api/vocabulary-pages.js','POST',body,{}, {...headers,cookie:'__Host-penina-quiz-session=1'})).code,403);
 assert.equal((await request('api/vocabulary-pages.js','POST',{...body,password:'2-wrong'},{},headers)).code,401);
 assert.equal((await request('api/vocabulary-pages.js','POST',body,{},headers)).code,200);
 const listing=await request('api/vocabulary-pages.js','GET',{}, {},headers);assert.equal(listing.body.pages[0].id,'old-page');
});
