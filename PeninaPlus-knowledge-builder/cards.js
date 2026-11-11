(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PeninaKnowledgeCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const FORMAT = 'penina-knowledge-cards';
    const text = value => typeof value === 'string' ? value.trim() : '';
    const hasInformation = card => Boolean(text(card.additionalInformation));
    const choiceKey = value => text(value).normalize('NFKC').toLowerCase().replace(/[\u0591-\u05c7]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
    function validChoices(answer, choices) {
        return Array.isArray(choices) && choices.length === 4 && choices.every(value => typeof value === 'string' && value.length <= 500 && choiceKey(value) && choiceKey(value) !== choiceKey(answer))
            && new Set(choices.map(choiceKey)).size === 4;
    }
    function practiceCards(deck, language) {
        return deck.cards.filter(card => validChoices(card.answer, card.distractors?.[language]));
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
                const target = card.picture.target;
                if (target && (!Number.isFinite(target.x) || !Number.isFinite(target.y) || target.x < 0 || target.x > 1 || target.y < 0 || target.y > 1)) {
                    throw new Error(`Card ${i + 1} has an invalid picture target.`);
                }
                picture = {src: card.picture.src, alt: text(card.picture.alt), target: target ? {x: target.x, y: target.y} : null};
            }
            const distractors = {};
            for (const language of ['english', 'hebrew']) {
                const values = card.distractors?.[language];
                if (values !== undefined) {
                    if (!Array.isArray(values) || values.length !== 4 || values.some(value => typeof value !== 'string' || value.length > 500)) throw new Error(`Card ${i + 1} has invalid distractors.`);
                    distractors[language] = values.map(text);
                }
            }
            return {id, question: text(card.question), answer: text(card.answer), additionalInformation: text(card.additionalInformation), picture, distractors};
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
    return {FORMAT, normalizeDeck, hasInformation, printSheets, choiceKey, validChoices, practiceCards};
});
