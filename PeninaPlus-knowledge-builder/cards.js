(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PeninaKnowledgeCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    // Plain text remains authoritative for answer matching and generation. Formatting
    // is a small allowlisted paragraph/run model, never saved or trusted HTML.
    function normalizeTextFormat(text, format) {
        if (!format || !Array.isArray(format.paragraphs) || !format.paragraphs.length || format.paragraphs.length > 5000) return null;
        const paragraphs = [];
        for (const paragraph of format.paragraphs) {
            if (!paragraph || !Array.isArray(paragraph.runs) || paragraph.runs.length > 10000) return null;
            const runs = [];
            for (const run of paragraph.runs) {
                if (!run || typeof run.text !== 'string' || /[\r\n]/.test(run.text)) return null;
                if (!run.text) continue;
                const bold = run.bold === true, previous = runs[runs.length - 1];
                if (previous?.bold === bold) previous.text += run.text;
                else runs.push({text:run.text, bold});
            }
            paragraphs.push({runs, direction:['ltr','rtl'].includes(paragraph.direction) ? paragraph.direction : 'auto',
                align:['left','right','center'].includes(paragraph.align) ? paragraph.align : 'start'});
        }
        // Card normalization trims surrounding whitespace; trim its matching runs too.
        while (paragraphs.length) {
            const runs = paragraphs[0].runs;
            while (runs.length && !runs[0].text.trimStart()) runs.shift();
            if (runs.length) {runs[0].text = runs[0].text.trimStart(); break;}
            paragraphs.shift();
        }
        while (paragraphs.length) {
            const runs = paragraphs[paragraphs.length - 1].runs;
            while (runs.length && !runs[runs.length - 1].text.trimEnd()) runs.pop();
            if (runs.length) {runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd(); break;}
            paragraphs.pop();
        }
        if (!paragraphs.length || paragraphs.map(p => p.runs.map(run => run.text).join('')).join('\n') !== String(text || '').trim()) return null;
        return {paragraphs};
    }
    function formattedTextHTML(text, format) {
        const escape = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
        const normalized = normalizeTextFormat(text, format);
        if (!normalized) return escape(text);
        // Default alignment follows the view (centered cards, start-aligned notes).
        // Changing paragraph direction alone must not replace that alignment.
        return normalized.paragraphs.map(paragraph => `<span data-rich-paragraph dir="${paragraph.direction}" style="display:block;min-height:1em;white-space:pre-wrap;font-weight:400;text-align:${paragraph.align === 'start' ? 'inherit' : paragraph.align}">${paragraph.runs.map(run => run.bold ? '<strong style="font-weight:700">'+escape(run.text)+'</strong>' : escape(run.text)).join('') || '<br>'}</span>`).join('');
    }
    const FORMAT = 'penina-knowledge-cards';
    const text = value => typeof value === 'string' ? value.trim() : '';
    const hasInformation = card => Boolean(text(card.additionalInformation));
    const choiceKey = value => text(value).normalize('NFKC').toLowerCase().replace(/[\u0591-\u05c7]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
    const binaryPairs = [
        [['yes', 'כֵּן'], ['no', 'לֹא']],
        [['true', 'אֱמֶת'], ['false', 'שֶׁקֶר']],
        [['correct', 'נָכוֹן'], ['incorrect', 'לֹא נָכוֹן']],
    ];
    const unpoint = value => value.normalize('NFKD').replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/gu, '');
    function binaryDistractor(answer, mode = 'mixed') {
        const original = text(answer);
        const label = original.replace(/[.!?…׃]+$/u, '').trim();
        const punctuation = original.slice(label.length).trim().slice(0, 3);
        const key = unpoint(label).toLowerCase().replace(/[\s־-]+/gu, ' ');
        for (const pair of binaryPairs) {
            const index = pair.findIndex(([english, hebrew]) => key === english || key === unpoint(hebrew));
            if (index < 0) continue;
            const [english, hebrew] = pair[1 - index];
            if (mode === 'hebrew' || (mode === 'mixed' && /[א-ת]/u.test(label))) {
                return (/\p{M}/u.test(label.normalize('NFKD')) ? hebrew : unpoint(hebrew)) + punctuation;
            }
            if (/[a-z]/i.test(label) && label === label.toUpperCase()) return english.toUpperCase() + punctuation;
            return (/^[a-z]/.test(label) ? english : english[0].toUpperCase() + english.slice(1)) + punctuation;
        }
        return null;
    }
    function distractorSlots(answer, choices) {
        if (!binaryDistractor(answer)) return choices ? [...choices] : ['', '', ''];
        const filled = (choices || []).filter(value => value.trim());
        return filled.length ? filled : [''];
    }
    // Known opposites need no model call. Keep multi-choice banks explicitly supplied by a teacher.
    function planDistractors(requests, mode) {
        const paired = [], aiRows = [];
        for (const row of requests) {
            const opposite = binaryDistractor(row.definition, mode);
            if (!opposite) {
                aiRows.push(row);
                continue;
            }
            let slot = row.slots[0];
            if (row.answers.some(value => value.trim())) {
                // Leave filled manual choices alone unless the teacher selects one for regeneration.
                const existing = row.answers.findIndex(value => choiceKey(value) === choiceKey(opposite));
                slot = row.slots.find(i => existing >= 0 ? i === existing : row.answers[i].trim());
            }
            paired.push({id: row.id, cells: slot === undefined ? [] : [{slot, answer: opposite}]});
        }
        return {paired, aiRows};
    }
    function validChoices(answer, choices) {
        return Array.isArray(choices) && choices.length >= 1 && choices.length <= 5 && choices.every(value => typeof value === 'string' && value.length <= 500 && choiceKey(value) && choiceKey(value) !== choiceKey(answer))
            && new Set(choices.map(choiceKey)).size === choices.length;
    }
    function practiceCards(deck, language) {
        return deck.cards.filter(card => validChoices(card.answer, card.distractors?.[language]));
    }
    function answerLanguage(value) {
        const text = value.normalize('NFKD');
        const english = /\p{Script=Latin}/u.test(text);
        if (/[א-ת]/u.test(text)) return english ? 'mixed' : 'hebrew';
        return english ? 'english' : 'other';
    }
    function matchesAnswerWording(choice, correctAnswer) {
        const language = answerLanguage(correctAnswer);
        if (answerLanguage(choice) !== language) return false;
        if (language !== 'hebrew' && language !== 'mixed') return true;
        // Normalize only for comparison. Keep the teacher's spelling and marks in the saved text.
        const hebrewWords = value => value.normalize('NFKD').match(/[א-ת][א-ת\p{M}]*(?:[׳״'"][א-ת][א-ת\p{M}]*)*/gu) || [];
        const correct = hebrewWords(correctAnswer), proposed = hebrewWords(choice);

        const pointed = word => /[\u05b0-\u05bd\u05bf\u05c1\u05c2\u05c7]/u.test(word);
        if (correct.some(pointed) !== proposed.some(pointed)) return false;
        if (correct.every(pointed) && !proposed.every(pointed)) return false;
        // A card can point one name and leave another bare. Check repeated words individually.
        const letters = word => word.replace(/\p{M}/gu, '');
        return proposed.every(word => {
            const variants = correct.filter(original => letters(original) === letters(word));
            return !variants.length || variants.includes(word);
        });
    }
    function matchesDistractorLanguage(choice, correctAnswer, mode) {
        if (mode === 'mixed') return matchesAnswerWording(choice, correctAnswer);
        // A number or numeric date can be written the same way in either language.
        const numeric = value => /\p{N}/u.test(value) && !/\p{L}/u.test(value);
        if (numeric(correctAnswer) && numeric(choice)) return true;
        return mode === 'hebrew' ? /[א-ת]/u.test(choice) : /[a-z]/i.test(choice) && !/[א-ת]/u.test(choice);
    }
    const pictureTargets = picture => Array.isArray(picture?.targets) ? picture.targets : picture?.target ? [picture.target] : [];
    function validPictureTarget(target) {
        const point = value => value && [value.x, value.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1);
        return Boolean(point(target) && (target.type === undefined || target.type === 'arrow') &&
            (target.type !== 'arrow' || (point(target.tail) && (target.x !== target.tail.x || target.y !== target.tail.y))));
    }
    function copyPictureTarget(target) {
        return {x: target.x, y: target.y, ...(target.type === 'arrow' ? {type: 'arrow', tail: {x: target.tail.x, y: target.tail.y}} : {})};
    }
    // These renderers are also embedded in downloaded study apps and printable sheets.
    // Keep them self-contained so those files continue to work offline.
    function arrowMarkup(target, label = '') {
        if (target?.type !== 'arrow' || ![target.x, target.y, target.tail?.x, target.tail?.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return '';
        label = /^[A-E1-5]$/.test(label) ? label : '';
        const id = 'picture-arrow-' + Math.random().toString(36).slice(2);
        const line = `x1="${target.tail.x * 100}%" y1="${target.tail.y * 100}%" x2="${target.x * 100}%" y2="${target.y * 100}%"`;
        return `<svg class="picture-arrow" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" role="img" aria-label="Arrow${label ? ' ' + label : ' pointing to marked location'}" style="position:absolute;inset:0;overflow:visible;pointer-events:none"><defs><marker id="${id}" markerWidth="16" markerHeight="16" refX="12" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M3 3 L12 8 L3 13" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3 L12 8 L3 13" fill="none" stroke="#d92323" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></marker></defs><line ${line} stroke="white" stroke-width="7" stroke-linecap="round"/><line ${line} stroke="#d92323" stroke-width="3" stroke-linecap="round" marker-end="url(#${id})"/></svg>` +
            (label ? `<span class="arrow-label" aria-hidden="true" style="position:absolute;left:${target.tail.x * 100}%;top:${target.tail.y * 100}%;transform:translate(-50%,-50%);display:grid;place-items:center;width:24px;height:24px;border:2px solid #d92323;border-radius:50%;background:white;color:#b42318;font:700 16px/1 Arial,sans-serif;pointer-events:none">${label}</span>` : '');
    }
    function drawPictureArrow(ctx, target, left, top, width, height, label = '', scale = 1) {
        const x = left + target.x * width, y = top + target.y * height;
        const tx = left + target.tail.x * width, ty = top + target.tail.y * height;
        const angle = Math.atan2(y - ty, x - tx), head = Math.min(12 * scale, Math.hypot(x - tx, y - ty) * .45);
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const [color, lineWidth] of [['#fff', 7], ['#d92323', 3]]) {
            ctx.strokeStyle = color; ctx.lineWidth = lineWidth * scale;
            ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y);
            ctx.moveTo(x - head * Math.cos(angle - .5), y - head * Math.sin(angle - .5));
            ctx.lineTo(x, y); ctx.lineTo(x - head * Math.cos(angle + .5), y - head * Math.sin(angle + .5)); ctx.stroke();
        }
        if (label) {
            ctx.beginPath(); ctx.arc(tx, ty, 12 * scale, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2 * scale; ctx.stroke();
            ctx.fillStyle = '#b42318'; ctx.font = `bold ${16 * scale}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'ltr'; ctx.fillText(label, tx, ty);
        }
        ctx.restore();
    }
    function normalizeDeck(input) {
        if (!input || input.format !== FORMAT || input.version !== 1 || !Array.isArray(input.cards)) {
            throw new Error('Choose a Penina Knowledge Builder draft.');
        }
        if (input.cards.length > 500) throw new Error('A set can contain up to 500 cards.');
        const ids = new Set();
        const cards = input.cards.map((card, i) => {
            if (!card || !text(card.question) || !text(card.answer)) throw new Error(`Card ${i + 1} needs a question and an answer.`);
            const id = text(card.id) || `card-${i + 1}`;
            if (ids.has(id)) throw new Error('This draft has duplicate card identifiers.');
            ids.add(id);
            let picture = null;
            if (card.picture) {
                if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(card.picture.src || '')) {
                    throw new Error(`Card ${i + 1} has an unsupported picture. Use a PNG, JPEG, WebP, or GIF.`);
                }
                if (card.picture.targets !== undefined && (!Array.isArray(card.picture.targets) || card.picture.targets.length > 5)) {
                    throw new Error(`Card ${i + 1} can have up to 5 picture targets.`);
                }
                const targets = pictureTargets(card.picture).map(target => {
                    if (!validPictureTarget(target)) {
                        throw new Error(`Card ${i + 1} has an invalid picture target.`);
                    }
                    return copyPictureTarget(target);
                });
                picture = {src: card.picture.src, alt: text(card.picture.alt), target: targets[0] || null,
                    ...(targets.length > 1 ? {targets} : {})};
            }
            const distractors = {};
            for (const language of ['english', 'hebrew']) {
                const values = card.distractors?.[language];
                if (values !== undefined) {
                    if (!Array.isArray(values) || (values.length < 1 || values.length > 5) || values.some(value => typeof value !== 'string' || value.length > 500)) throw new Error(`Card ${i + 1} has invalid distractors.`);
                    distractors[language] = distractorSlots(card.answer, values.map(text));
                }
            }
            const textFormatting = {};
            for (const field of ['question','answer','additionalInformation']) {
                const format = normalizeTextFormat(text(card[field]), card.textFormatting?.[field]);
                if (format) textFormatting[field] = format;
            }
            return {...(Object.keys(textFormatting).length ? {textFormatting} : {}), id, question: text(card.question), answer: text(card.answer), additionalInformation: text(card.additionalInformation), picture, distractors};
        });
        return {format: FORMAT, version: 1, title: text(input.title) || 'Untitled knowledge set', cards};
    }
    function printSheets(cards, count = 4) {
        if (![1, 2, 4].includes(count)) throw new Error('Choose 1, 2, or 4 cards per page.');
        const pages = [];
        for (let start = 0; start < cards.length; start += count) {
            const front = Array.from({length: count}, (_, i) => cards[start + i] || null);
            // Two-column backs mirror left/right: short-edge landscape or long-edge portrait duplex.
            const back = count === 4 ? [front[1], front[0], front[3], front[2]] : [...front];
            pages.push({side: 'front', cards: front}, {side: 'back', cards: back});
        }
        return pages;
    }
    return {normalizeTextFormat, formattedTextHTML, FORMAT, normalizeDeck, hasInformation, printSheets, choiceKey, validChoices, practiceCards, binaryDistractor, distractorSlots, planDistractors, answerLanguage, matchesAnswerWording, matchesDistractorLanguage, pictureTargets, validPictureTarget, copyPictureTarget, arrowMarkup, drawPictureArrow};
});
