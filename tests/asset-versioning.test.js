const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const {build, publicFiles} = require('../scripts/version-assets');
const {versionReferences} = require('../lib/asset-urls');
const root = path.join(__dirname, '..');
function fixture(t, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penina-assets-'));
    t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
    fs.mkdirSync(path.join(dir, 'lib'));
    for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive:true});
        fs.writeFileSync(path.join(dir, file), text);
    }
    return dir;
}
test('Changed dependencies update their loaders and page URLs; unchanged assets keep their versions', t => {
    const dir = fixture(t, {
        'app/index.html':'<script src="loader.js?v=old"></script><link rel="stylesheet" href="style.css"><a href="/app/">Quiz link</a><script src="https://cdn.example.org/library.js"></script>',
        'app/loader.js':"const script=document.createElement('script');script.src='/shared.js';",
        'shared.js':'window.example=1;', 'app/style.css':'body{color:blue}',
        'app/vendor/library.js':'/* vendor */', 'archive/old.html':'<script src="/shared.js"></script>'
    });
    const first = build(dir), read = file => fs.readFileSync(path.join(dir, file), 'utf8');
    assert.match(read('app/index.html'), new RegExp('loader.js\\?v=' + first.versions['/app/loader.js']));
    assert.match(read('app/loader.js'), new RegExp('/shared.js\\?v=' + first.versions['/shared.js']));
    assert.match(read('app/index.html'), /href="\/app\/"/);
    assert.match(read('app/index.html'), /src="https:\/\/cdn.example.org\/library.js"/);
    assert.equal(read('archive/old.html'), '<script src="/shared.js"></script>');
    assert.deepEqual(build(dir).versions, first.versions, 'repeat builds are stable');
    fs.writeFileSync(path.join(dir, 'shared.js'), 'window.example=2;');
    const second = build(dir);
    assert.notEqual(second.versions['/shared.js'], first.versions['/shared.js']);
    assert.notEqual(second.versions['/app/loader.js'], first.versions['/app/loader.js']);
    assert.equal(second.versions['/app/style.css'], first.versions['/app/style.css']);
    assert.equal(second.versions['/app/vendor/library.js'], first.versions['/app/vendor/library.js']);
    assert.match(read('app/index.html'), new RegExp('loader.js\\?v=' + second.versions['/app/loader.js']));
});
test('Versioning preserves relative addresses, query options, fragments, and external URLs', () => {
    const source = '<script src="../shared.js?mode=quiz&amp;v=old#part"></script><script src="//cdn.example.org/shared.js"></script><img src="/logo.png?v=4">';
    const output = versionReferences(source, '/app/index.html', asset => asset === '/shared.js' ? 'new' : null);
    assert.equal(output, source.replace('v=old', 'v=new'));
    assert.equal(versionReferences("script.src='relative.js';", '/app/loader.js', () => 'hash', true), "script.src='relative.js';");
});
test('A circular dependency fails before changing build files', t => {
    const dir = fixture(t, {'a.js':"script.src='/b.js';", 'b.js':"script.src='/a.js';"});
    assert.throws(() => build(dir), /Circular asset URL dependency/);
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), "script.src='/b.js';");
});
test('Every current public page and asset builds, including dynamically loaded shared scripts', t => {
    const files = Object.fromEntries(publicFiles(root).map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
    const dir = fixture(t, files), result = build(dir);
    for (const app of ['Penina-Reader', 'PeninaPlus-Reader', 'PeninaPlus-vocab-builder', 'PeninaPlus-Binyan-Builder', 'Penina-Quizzes']) {
        assert.ok(Object.keys(files).some(file => file.startsWith(app + '/') && file.endsWith('.html')));
    }
    for (const [asset, version] of Object.entries(result.versions)) {
        const contents = fs.readFileSync(path.join(dir, asset.slice(1)));
        assert.equal(createHash('sha256').update(contents).digest('hex').slice(0, 16), version);
        if (asset.endsWith('.js')) assert.doesNotThrow(() => new vm.Script(contents.toString(), {filename:asset}));
    }
    for (const page of ['index.html', 'Penina-Quizzes/custom/teacher.html', 'Penina-Quizzes/custom/index.html', 'PeninaPlus-Reader/index.html', 'PeninaPlus-vocab-builder/index.html']) {
        assert.match(fs.readFileSync(path.join(dir, page), 'utf8'), /\.js\?v=[a-f0-9]{16}/);
    }
    const quiz = fs.readFileSync(path.join(dir, 'Penina-Quizzes/custom/quiz.js'), 'utf8');
    assert.ok(quiz.includes('/session-idle.js?v=' + result.versions['/session-idle.js']));
    assert.ok(quiz.includes('/return-to-penina.js?v=' + result.versions['/return-to-penina.js']));
    assert.deepEqual(build(dir).versions, result.versions);
});
test('Static pages and scripts revalidate while protected pages retain their gateway rules', () => {
    const config = require('../vercel.json');
    const rule = config.routes.find(route => route.headers?.['Cache-Control'] === 'public, no-cache');
    const matches = value => new RegExp(rule.src).test(value);
    assert.equal(rule.continue, true);
    for (const url of ['/', '/FAQ/', '/FAQ', '/index.html', '/homepage-teachers.js', '/Penina-Quizzes/custom/quiz.css', '/PeninaPlus-vocab-builder/flash-cards/live/']) assert.ok(matches(url), url);
    for (const url of ['/api/game-scores', '/api/generate.js', '/logo.png', '/DavidLibre-Regular.ttf', '/video.mp4']) assert.ok(!matches(url), url);
    assert.equal(config.buildCommand, 'npm run build');
    assert.ok(config.functions['api/game-scores.js'].includeFiles.includes('lib/asset-manifest.json'));
});
