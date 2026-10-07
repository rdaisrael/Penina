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
    const create = body => request('api/vocabulary-pages.js', 'POST', { creationPassword: '123-aw', ...body });
    return { request, create, blobs, env };
}

test('Creation accepts digits followed by -aw even with a legacy environment override', async () => {
    const { request, blobs } = server();
    const body = { name: 'New Class', password: 'page-password' };
    for (const creationPassword of ['1234', 'wrong', '1-wc', '1-AW', '-aw', 'a-aw', '-1-aw', '1.5-aw', ' 1-aw', '1-aw ', '1-aw\n', '1-aw\r', 'test-admin-password', '1'.repeat(254) + '-aw']) {
        assert.equal((await request('api/vocabulary-pages.js', 'POST', { ...body, creationPassword })).code, 401);
        assert.equal(blobs.size, 0);
    }
    for (const creationPassword of ['0-aw', '1-aw', '123-aw', '00123-aw']) {
        assert.equal((await request('api/vocabulary-pages.js', 'POST', {
            ...body, name: 'Class ' + creationPassword, creationPassword
        })).code, 201);
    }
});

test('Created pages persist across requests, list alongside grades, and expose no credentials', async () => {
    const { request, create, blobs } = server();
    const created = await create({ name: '  Ninth   Grade  ', password: 'סיסמה<&> secret' });
    assert.equal(created.code, 201);
    assert.equal(created.body.page.name, 'Ninth Grade');
    assert.equal(created.body.page.url, '/PeninaPlus-vocab-builder/flash-cards/?page=ninth-grade');
    await create({ name: 'מילים', password: 'another-password' });
    const listing = await request('api/vocabulary-pages.js', 'GET');
    assert.equal(listing.code, 200);
    assert.equal(listing.body.pages.length, 5);
    assert.equal(listing.headers['Cache-Control'], 'no-store');
    assert(listing.body.pages.some(page => page.id === 'sixth'));
    assert(listing.body.pages.some(page => page.id === 'ninth-grade'));
    for (const page of listing.body.pages) assert.deepEqual(Object.keys(page).sort(), ['id', 'name', 'url']);
    for (const blob of blobs.values()) {
        assert(!blob.content.includes('secret'));
        assert(!blob.content.includes('another-password'));
    }
});

test('Duplicate and concurrent creates cannot overwrite another page password', async () => {
    const { request, create } = server();
    const results = await Promise.all(['first', 'second'].map(password => create({ name: 'My Class', password })));
    assert.deepEqual(results.map(result => result.code).sort(), [201, 409]);
    const duplicate = await create({ name: 'MY CLASS', password: 'replacement' });
    assert.equal(duplicate.code, 409);
    const originalPassword = results[0].code === 201 ? 'first' : 'second';
    assert.equal((await request('api/flashcard-sets.js', 'POST', { grade: 'my-class', action: 'authenticate', password: originalPassword })).code, 200);
    assert.equal((await request('api/flashcard-sets.js', 'POST', { grade: 'my-class', action: 'authenticate', password: 'replacement' })).code, 401);
});

test('Duplicate names ignore capitalization, extra whitespace, and Unicode variants', async () => {
    const { create, blobs } = server();
    assert.equal((await create({ name: 'My Class', password: 'original' })).code, 201);
    for (const name of ['My Class', 'MY CLASS', '  my   class  ', 'Ｍｙ Ｃｌａｓｓ']) {
        const result = await create({ name, password: 'replacement' });
        assert.equal(result.code, 409);
        assert.match(result.body.error, /already exists/);
        assert.equal(blobs.size, 1);
    }
    assert.equal((await create({ name: 'מילים', password: 'original' })).code, 201);
    assert.equal((await create({ name: '  מילים  ', password: 'replacement' })).code, 409);
    assert.equal(blobs.size, 2);
});

test('A custom page supports empty view, publishing, viewing, authentication, and deletion with its own password', async () => {
    const { request, create } = server();
    const password = ' סיסמה secret ';
    const grade = 'ninth';
    await create({ name: 'Ninth', password });
    await create({ name: 'Tenth', password: 'different' });
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
    assert.equal((await request('api/flashcard-sets.js', 'DELETE', { grade, password: 'different', pathnames: [pathname] })).code, 401);
    assert.equal((await request('api/flashcard-sets.js', 'DELETE', { grade: 'tenth', password: 'different', pathnames: [pathname] })).code, 400);
    assert.equal((await request('api/flashcard-sets.js', 'DELETE', { grade, password, pathnames: [pathname] })).code, 200);
    assert.equal((await request('api/flashcard-sets.js', 'GET', {}, { grade })).body.sets.length, 0);
});

test('Invalid names, missing passwords, unknown pages, and existing grade names are rejected', async () => {
    const { request, create } = server();
    for (const body of [{ name: ' ', password: 'ok' }, { name: 'New', password: '  ' }, { name: 'a'.repeat(121), password: 'ok' }, { name: 'New', password: 'x'.repeat(257) }]) {
        assert.equal((await create(body)).code, 400);
    }
    for (const name of ['Sixth', 'Sixth Grade Gemara Vocabulary', 'SEVENTH']) {
        assert.equal((await create({ name, password: 'ok' })).code, 409);
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
    const result = await create({ name: 'New Page', password: 'private-value' });
    assert.equal(result.code, 500);
    assert(!JSON.stringify(result.body).includes('private-value'));
    assert.equal(blobs.size, 0);
});


test('Page creation requires the creation password pattern before any page is saved', async () => {
    const { request, blobs } = server();
    for (const creationPassword of [undefined, '', 'wrong!', '1235', 1234, ['test-admin-password']]) {
        const result = await request('api/vocabulary-pages.js', 'POST', {
            name: 'Protected Page', password: 'page-publishing-password', creationPassword
        });
        assert.equal(result.code, 401);
        assert.equal(blobs.size, 0);
        assert(!JSON.stringify(result.body).includes('test-admin-password'));
    }
    const created = await request('api/vocabulary-pages.js', 'POST', {
        name: 'Protected Page', password: 'page-publishing-password', creationPassword: '123-aw'
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
        grade: 'protected-page', action: 'authenticate', password: 'page-publishing-password'
    })).code, 200);
});

test('Game choices require the class password, persist, and remain isolated by class', async () => {
    const { request, create } = server();
    await create({ name: 'Game Class', password: 'editing-code' });
    await create({ name: 'Other Class', password: 'other-code' });
    const body = { grade: 'game-class', action: 'game-settings', password: 'editing-code', disabledGames: ['quiz', 'chomp'] };
    assert.equal((await request('api/flashcard-sets.js', 'POST', { ...body, password: 'wrong' })).code, 401);
    assert.equal((await request('api/flashcard-sets.js', 'POST', { ...body, disabledGames: ['unknown'] })).code, 400);
    assert.equal((await request('api/flashcard-sets.js', 'POST', body)).code, 200);
    const listing = await request('api/flashcard-sets.js', 'GET', {}, { grade: 'game-class' });
    assert.deepEqual(listing.body.disabledGames, ['quiz', 'chomp']);
    const other = await request('api/flashcard-sets.js', 'GET', {}, { grade: 'other-class' });
    assert.deepEqual(other.body.disabledGames, []);
    const cards = [{ term: 'סוס', english: 'horse', alternativeAnswers: { english: { term: 'סוס', definition: 'horse', answers: ['cow','dog','cat','bird'] } } }];
    const html = require('../PeninaPlus-vocab-builder/offline-study-cards').makeApp('Review', cards);
    assert.equal((await request('api/flashcard-sets.js', 'POST', { grade: 'game-class', password: 'editing-code', title: 'Review', html })).code, 201);
    const games = await request('api/flashcard-sets.js', 'GET', {}, { grade: 'game-class', games: '1' });
    assert.equal(games.code, 200);
    assert(!games.body.includes('data-game="quiz"')); assert(!games.body.includes('data-game="chomp"'));
    assert(games.body.includes('data-game="asteroids"'));
    assert.equal((await request('api/flashcard-sets.js', 'POST', { ...body, disabledGames: [] })).code, 200);
    const restored = await request('api/flashcard-sets.js', 'GET', {}, { grade: 'game-class', games: '1' });
    assert(restored.body.includes('data-game="quiz"')); assert(restored.body.includes('data-game="chomp"'));
});
