const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../PeninaPlus-vocab-builder/index.html'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const searchCode = between('async function performSefariaSearch(', 'function stripSefariaLineNumber(');
const abbreviationCode = between('function isLikelyHebrewAbbreviation(', 'async function expandHebrewAbbreviation(');
const dafCode = between('function generateDafOptions(', 'function getSelectedTalmudMode(');

function createSearch(fetch, semantic = async () => 'YES') {
    const context = {
        fetch, AbortSignal,
        englishBookCache: new Map(), refDataCache: new Map(),
        talmudPerekDataCache: new Map(), sefariaIndexCache: new Map(),
        semanticContextValidationCache: new Map(),
        callTranslateOneGlobal: semantic
    };
    vm.createContext(context);
    vm.runInContext(abbreviationCode + dafCode + searchCode, context);
    return { search: context.performSefariaSearch, context };
}
module.exports = { createSearch };
