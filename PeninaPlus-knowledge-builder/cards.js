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
    function validChoices(answer, choices) {
        return Array.isArray(choices) && choices.length >= 1 && choices.length <= 5 && choices.every(value => typeof value === 'string' && value.length <= 500 && choiceKey(value) && choiceKey(value) !== choiceKey(answer))
            && new Set(choices.map(choiceKey)).size === choices.length;
    }
    function practiceCards(deck, language) {
        return deck.cards.filter(card => validChoices(card.answer, card.distractors?.[language]));
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
                    distractors[language] = values.map(text);
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
    return {normalizeTextFormat, formattedTextHTML, FORMAT, normalizeDeck, hasInformation, printSheets, choiceKey, validChoices, practiceCards, pictureTargets, validPictureTarget, copyPictureTarget, arrowMarkup, drawPictureArrow};
});
