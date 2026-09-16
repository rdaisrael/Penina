(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReaderCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const marks = /[\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/g;
    const wordPattern = /[\u05D0-\u05EA][\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7\u05D0-\u05EA]*/g;
    const normalizeWord = text => String(text).normalize('NFD').replace(marks, '').replace(/[^\u05D0-\u05EA]/g, '');
    const skeleton = text => String(text).normalize('NFD').replace(marks, '').replace(/\r\n/g, '\n').trim();
    const words = text => [...String(text).matchAll(new RegExp(wordPattern.source, 'g'))];
    const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const pronouns = new Set('אני אתה את הוא היא אנחנו אנו אתם אתן הם הן שלי שלך שלו שלה שלנו שלכם שלכן שלהם שלהן'.split(' '));
    function normalizeVocabulary(profile) {
        if (!profile || !['complete','pos','upload'].includes(profile.mode)) throw new Error('Invalid vocabulary mode.');
        const result = {mode: profile.mode};
        for (const key of ['words','verbs','nouns','adjs','forms']) {
            if (!Array.isArray(profile[key]) || profile[key].some(x => typeof x !== 'string')) throw new Error('Invalid vocabulary list.');
            result[key] = [...new Set(profile[key].map(x => key === 'forms' ? x.trim() : normalizeWord(x)).filter(Boolean))];
        }
        return result;
    }
    function validateAnalysis(data, profile, sourceText) {
        if (!data || typeof data.text !== 'string' || !Array.isArray(data.words)) throw new Error('The reader analysis is incomplete. Please generate again.');
        const text = data.text.trim();
        if (!text.includes('\n') || !text.split('\n').slice(1).join('').trim()) throw new Error('The story must include a title and body.');
        if (sourceText !== undefined && skeleton(text) !== skeleton(sourceText)) throw new Error('The analysis changed the supplied text. Your original text has been kept; please try again.');
        const tokens = words(text);
        if (!tokens.length || tokens.length !== data.words.length) throw new Error('Word analysis does not match the story. Please generate again.');
        const normalized = normalizeVocabulary(profile);
        const entries = normalized.mode === 'complete' ? normalized.words : [...normalized.verbs,...normalized.nouns,...normalized.adjs];
        const analysis = data.words.map((item, i) => {
            if (!item || normalizeWord(item.word) !== normalizeWord(tokens[i][0]) || typeof item.mastered !== 'boolean' || typeof item.translation !== 'string' || !item.translation.trim() || typeof item.match !== 'string' || typeof item.form !== 'string') throw new Error('Invalid word analysis. Please generate again.');
            // Older saved analyses have no prefix metadata; retain their exact-word grouping.
            const prefix = item.prefix === undefined ? '' : item.prefix;
            const surface = normalizeWord(item.word);
            if (typeof prefix !== 'string' || !/^[לבשה]*$/.test(prefix) || !surface.startsWith(prefix) || prefix.length >= surface.length) throw new Error('Invalid word prefix analysis. Please generate again.');
            const match = normalizeWord(item.match);
            const known = entries.includes(match) || (item.match === '__pronoun__' && pronouns.has(normalizeWord(item.word)));
            const verbAllowed = normalized.mode === 'complete' || !normalized.verbs.includes(match) || normalized.forms.includes(item.form);
            return {...item, prefix, mastered: item.mastered && known && verbAllowed};
        });
        return {text: sourceText === undefined ? text : sourceText.trim(), words: analysis, vocabulary: normalized};
    }
    function buildResult(text, analysis, dictaTokens = []) {
        const vocalized = words(text);
        if (!analysis || vocalized.length !== analysis.words.length) throw new Error('Vocalization changed the source word count. Please try again.');
        const nativePairs = dictaTokens.flatMap(token => {
            const original = words(token.str || '');
            const selected = token.sep ? (token.nakdan?.word || token.str || '') : (token.nakdan?.options?.[0]?.w || token.str || '');
            const pointed = words(selected.replace(/\|/g, ''));
            return original.length === pointed.length ? original.map((word, i) => [normalizeWord(word[0]), pointed[i][0]]) : [];
        });
        const spellingChanges = [];
        const mismatch = vocalized.findIndex((token, i) => {
            const original = normalizeWord(analysis.words[i].word), pointed = normalizeWord(token[0]);
            if (original === pointed) return false;
            // Full spelling can contain extra vowel letters (סיפורים -> סִפּוּרִים).
            // Accept this only from Dicta's selected option for the exact original token.
            const native = nativePairs[i];
            const permitted = nativePairs.length === vocalized.length && native?.[0] === original && native?.[1] === token[0] && original.replace(/[וי]/g, '') === pointed.replace(/[וי]/g, '');
            if (permitted) spellingChanges.push({source:analysis.words[i].word, pointed:token[0]});
            return !permitted;
        });
        if (mismatch !== -1) throw new Error(`Vocalization changed the source word “${analysis.words[mismatch].word}” to “${vocalized[mismatch][0]}”. Please try again.`);
        // Dicta may normalize whitespace/punctuation. Retain the source layout verbatim
        // and accept only vocalization of the same Hebrew consonants in the same order.
        let wordIndex = 0;
        text = analysis.text.replace(new RegExp(wordPattern.source, 'g'), () => vocalized[wordIndex++][0]);
        const tokens = words(text);
        const notes = [], ids = new Map();
        const tokenAnalysis = analysis.words.map((item, i) => {
            // Group by the same word form after removing contextually identified prefixes.
            const key = normalizeWord(item.word).slice((item.prefix || '').length);
            let noteId = null;
            if (!item.mastered) {
                if (!ids.has(key)) { ids.set(key, notes.length + 1); notes.push({id: notes.length + 1, word: tokens[i][0], translation: item.translation.trim()}); }
                noteId = ids.get(key);
                const note = notes[noteId - 1];
                if (!note.translation.toLowerCase().split('; ').includes(item.translation.trim().toLowerCase())) note.translation += '; ' + item.translation.trim();
            }
            return {...item, word: tokens[i][0], start: tokens[i].index, noteId};
        });
        return {text, sourceText:analysis.text, spellingChanges, words: tokenAnalysis, notes, vocabulary: analysis.vocabulary};
    }
    function validateWorksheet(text, count) {
        if (typeof text !== 'string') throw new Error('The worksheet response is missing.');
        const lines = text.trim().split('\n');
        const title = lines.shift();
        const questions = [];
        let current;
        for (const line of lines) {
            if (!line.trim()) continue;
            const match = line.match(/^\s*(\d+)\.\s+(.+)/);
            if (match) { current = {number:Number(match[1]), text:match[2], lines:0}; questions.push(current); }
            else if (line.trim() === '[LINE]' && current) current.lines++;
            else throw new Error('Worksheet formatting was incomplete. Please generate it again.');
        }
        if (!title || questions.length !== Number(count) || questions.some((q,i) => q.number !== i+1 || q.lines < 2 || q.lines > 4)) throw new Error('Worksheet question count or answer lines did not match the request. Please generate it again.');
        return {title,questions};
    }
    function createRequestTracker() {
        let story = 0, worksheet = 0;
        return {
            beginStory() { worksheet++; return ++story; },
            beginWorksheet() { return {story, worksheet:++worksheet}; },
            isStory(id) { return id === story; },
            isWorksheet(id) { return id.story === story && id.worksheet === worksheet; }
        };
    }
    return {normalizeWord, skeleton, words, escapeHtml, normalizeVocabulary, validateAnalysis, buildResult, validateWorksheet, createRequestTracker};
});
