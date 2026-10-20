"use strict";
// Shared presentation; existing correction forms remain responsible for saving grades.
window.QuizCorrection = (() => {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function compareStudents(a, b) {
        const parts = student => {
            const name = String(student.name || '').trim().replace(/\s+/g, ' ');
            if (name.includes(',')) {
                const [last, ...first] = name.split(',');
                return [last.trim(), first.join(',').trim()];
            }
            const words = name.split(' ');
            return [words.pop(), words.join(' ')];
        };
        const [lastA, firstA] = parts(a), [lastB, firstB] = parts(b);
        const compare = (x, y) => x.localeCompare(y, undefined, {sensitivity:'base'});
        return compare(lastA, lastB) || compare(firstA, firstB) || compare(String(a.id || ''), String(b.id || ''));
    }
    function state(score, max) {
        if (score === null || score === undefined) return ['pending', 'Needs correction'];
        if (score === max) return ['correct', '✓ Correct'];
        if (score === 0) return ['incorrect', '✕ Incorrect'];
        return ['partial', '◐ Partial credit'];
    }
    function question(q, i, answers, auto, manual, step) {
        const grade = auto || manual, max = grade.max, [kind, label] = state(grade.score, max);
        const reference = auto ? auto.correctAnswer : manual.modelAnswer;
        return `<section class="review-question ${q.extraCredit?'extra-credit':''}" data-grade="${kind}">
            <div class="question-heading"><span class="question-number">Question ${i+1}</span>${q.extraCredit?'<span class="extra-credit-badge">Extra credit</span>':''}<span class="grade-badge">${label}</span><span class="question-points">${grade.score ?? '—'} / ${max} points</span></div>
            <h2 class="review-prompt" dir="auto">${escape(q.prompt)}</h2>
            <div class="answer-comparison"><div class="student-response"><h3>Student’s answer</h3>${answers.map((a,j)=>`<div class="response-part">${q.fields ? `<span class="field-label" dir="auto">${escape(q.fields[j])}</span>` : answers.length > 1 ? `<span class="field-label">Part ${j+1}</span>` : ''}<p dir="auto">${escape(a || '(No answer)')}</p></div>`).join('')}</div>
            <div class="reference-response"><h3>${auto ? 'Correct answer' : 'Model answer'}</h3><p dir="auto">${escape(reference || 'No model answer provided.')}</p></div></div>
            <div class="question-marking">${auto ? `<label>Points awarded <span class="points-range">(0–${max})</span><input aria-label="Points for question ${i+1}" name="auto${i}" data-original="${auto.originalScore ?? auto.score}" type="number" min="0" max="${max}" step="${step}" value="${auto.score}" required></label><span class="marking-hint">Answer-key score: ${auto.originalScore ?? auto.score}/${max}. Change the points to override this student’s mark. <strong class="override-label">${auto.overridden ? 'Teacher override' : ''}</strong></span>` : `<label>Points awarded <span class="points-range">(0–${max})</span><input aria-label="Points for question ${i+1}" name="manual${i}" type="number" min="0" max="${max}" step="${step}" value="${manual.score ?? ''}" placeholder="—"></label><span class="marking-hint">Leave blank if this answer still needs correction.</span>`}</div>
            ${auto ? `<label class="override-explanation">Explanation for the student <span class="muted">(included in the email when you override this mark)</span><textarea name="explanation${i}" maxlength="2000" dir="auto" placeholder="For example: The answer key was incorrect. Your answer is correct, so I have awarded full credit.">${escape(auto.explanation || '')}</textarea></label>` : ''}
        </section>`;
    }
    document.addEventListener('input', event => {
        const input = event.target;
        const form=input.closest('form.correction');
        if(form) {
            form.dataset.classroomDraft='false';
            form.querySelector('[name="emailStudent"]').disabled=true;
        }
        if(input.matches('.correction textarea')) { input.closest('form').querySelector('.saveStatus').textContent='Unsaved changes — save corrections when you’re ready.'; return; }
        if (!input.matches('.correction input[name^="manual"], .correction input[name^="auto"]')) return;
        const card = input.closest('.review-question');
        if (!card) return;
        const valid = input.validity.valid, score = input.value === '' ? null : Number(input.value);
        const [kind,label] = valid ? state(score, Number(input.max)) : ['pending', 'Check points'];
        const overrideLabel = card.querySelector('.override-label');
        if (overrideLabel) overrideLabel.textContent = valid && score !== Number(input.dataset.original) ? 'Teacher override' : '';
        card.dataset.grade = kind;
        card.querySelector('.grade-badge').textContent = label;
        card.querySelector('.question-points').textContent = `${valid ? score ?? '—' : '—'} / ${input.max} points`;
        input.closest('form').querySelector('.saveStatus').textContent = 'Unsaved changes — save corrections when you’re ready.';
    });
    function overrides(form) {
        return Object.fromEntries([...form.querySelectorAll('input[name^="auto"]')]
            .filter(input => Number(input.value) !== Number(input.dataset.original))
            .map(input => [input.name.slice(4), Number(input.value)]));
    }
    function explanations(form) {
        const changed = overrides(form);
        return Object.fromEntries([...form.querySelectorAll('textarea[name^="explanation"]')]
            .filter(input => Object.hasOwn(changed,input.name.slice(11)))
            .map(input => [input.name.slice(11),input.value.trim()]));
    }
    return {question, overrides, explanations, compareStudents};
})();
