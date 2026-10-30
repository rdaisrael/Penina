'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {versionReferences} = require('../lib/asset-urls');
const excluded = new Set(['node_modules', 'api', 'lib', 'tests', 'scripts', 'docs', 'cloudflare', 'archive']);
function publicFiles(root, relative = '') {
    return fs.readdirSync(path.join(root, relative), {withFileTypes:true}).flatMap(entry => {
        if (entry.name.startsWith('.') || excluded.has(entry.name.toLowerCase())) return [];
        const file = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) return publicFiles(root, file);
        return entry.isFile() && /\.(?:html|m?js|css)$/.test(file) ? [file] : [];
    });
}
function build(root) {
    const files = publicFiles(root);
    const assets = new Map(files.filter(file => !file.endsWith('.html')).map(file => ['/' + file, fs.readFileSync(path.join(root, file), 'utf8')]));
    const versions = {}, output = new Map(), visiting = new Set();
    function version(assetPath) {
        if (!assets.has(assetPath)) return null;
        if (versions[assetPath]) return versions[assetPath];
        if (visiting.has(assetPath)) throw Error('Circular asset URL dependency: ' + assetPath);
        visiting.add(assetPath);
        // Vendored libraries are fingerprinted unchanged.
        const source = assets.get(assetPath);
        const compiled = assetPath.includes('/vendor/') ? source : versionReferences(source, assetPath, version, true);
        const hash = createHash('sha256').update(compiled).digest('hex').slice(0, 16);
        visiting.delete(assetPath);
        output.set(assetPath, compiled);
        versions[assetPath] = hash;
        return hash;
    }
    for (const assetPath of assets.keys()) version(assetPath);
    // Finish computing all versions before writing any files, so dependency errors
    // cannot leave a partially transformed build.
    for (const file of files.filter(file => file.endsWith('.html'))) {
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        output.set('/' + file, versionReferences(source, '/' + file, assetPath => versions[assetPath]));
    }
    for (const [file, content] of output) fs.writeFileSync(path.join(root, file.slice(1)), content);
    fs.writeFileSync(path.join(root, 'lib/asset-manifest.json'), JSON.stringify(versions, null, 2) + '\n');
    return {pages:files.filter(file => file.endsWith('.html')).length, assets:assets.size, versions};
}
if (require.main === module) {
    const result = build(path.resolve(__dirname, '..'));
    console.log(`Versioned ${result.assets} scripts/styles across ${result.pages} pages.`);
}
module.exports = {build, publicFiles};
