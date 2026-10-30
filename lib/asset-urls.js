'use strict';
// Shared by the build and the authenticated page renderer. Page URLs never change.
const origin = 'https://penina.invalid';
function localAssetPath(value, pagePath) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value) || value.includes('${')) return null;
    const url = new URL(value.replace(/&amp;/g, '&'), origin + pagePath);
    return /\.(?:m?js|css)$/.test(url.pathname) ? decodeURIComponent(url.pathname) : null;
}
function versionUrl(value, version) {
    const [beforeHash, ...fragment] = value.split('#');
    const index = beforeHash.indexOf('?');
    const pathname = index < 0 ? beforeHash : beforeHash.slice(0, index);
    const htmlEncoded = beforeHash.includes('&amp;');
    const query = new URLSearchParams(index < 0 ? '' : beforeHash.slice(index + 1).replace(/&amp;/g, '&'));
    query.set('v', version);
    const search = query.toString().replace(/&/g, htmlEncoded ? '&amp;' : '&');
    return pathname + '?' + search + (fragment.length ? '#' + fragment.join('#') : '');
}
// Match literal asset URLs, including dynamically inserted scripts in inline JS.
// In external JS only root-relative URLs are rewritten: relative script.src URLs
// resolve against the document, not the JS file. Unversioned requests revalidate.
function versionReferences(source, pagePath, getVersion, rootRelativeOnly = false) {
    return source.replace(/(["'`])([^"'`\s<>]+\.(?:m?js|css)(?:\?[^"'`\s<>#]*)?(?:#[^"'`\s<>]*)?)\1/g, (match, quote, value) => {
        if (rootRelativeOnly && !value.startsWith('/')) return match;
        const assetPath = localAssetPath(value, pagePath);
        const version = assetPath && getVersion(assetPath);
        return version ? quote + versionUrl(value, version) + quote : match;
    });
}
module.exports = {localAssetPath, versionUrl, versionReferences};
