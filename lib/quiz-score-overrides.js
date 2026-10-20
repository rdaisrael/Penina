// Overrides are question-indexed, teacher-only scores; the original answer/key stays intact.
function validOverrides(overrides, automatic, explanations = {}, manual = []) {
    if (!explanations || typeof explanations !== 'object' || Array.isArray(explanations) ||
        !Object.entries(explanations).every(([index,text]) => [...automatic,...manual].some(q=>String(q.index)===index) && typeof text==='string' && text.length<=2000)) return false;
    if (overrides === undefined) return true;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return false;
    return Object.entries(overrides).every(([index, score]) => {
        const item = automatic.find(q => String(q.index) === index);
        return item && typeof score === 'number' && Number.isFinite(score) &&
            score >= 0 && score <= item.max && Number.isInteger(score / (item.step || 0.5));
    });
}
function applyOverrides(automatic, overrides, explanations = {}) {
    const valid = validOverrides(overrides, automatic);
    for (const item of automatic) {
        item.originalScore = item.score;
        item.overridden = valid && overrides !== undefined && Object.hasOwn(overrides, item.index);
        if (item.overridden) item.score = overrides[item.index];
        item.explanation = item.overridden && typeof explanations[item.index] === 'string' ? explanations[item.index] : '';
    }
}
module.exports = {validOverrides, applyOverrides};
