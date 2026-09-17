# PeninaPlus Binyan Builder

Route: `/PeninaPlus-Binyan-Builder/`.

## Current scope

Only קל (פעל), with Regular (`פעל שלם`) and Lamed hey (`פעל ל-ה`), is available in both the UI and server API. Supported forms: past, present, future, infinitive and imperative. Verbal nouns are excluded because the tested Dicta noun analysis does not establish their root/binyan relationship. Other binyanim and root groups are unavailable.

The Reader workbook/parser is unchanged. Unsupported learned marks are filtered out, not treated as a corrupt workbook. Practice still requires exact X-marked supported pairs. Learn needs only roots. Select one visible combination directly or enable mixed practice for up to eight combinations; worksheets have 6–30 questions, model tables in Learn, and a separate printable answer key.

Root eligibility is deterministic. Lamed hey accepts three-letter roots ending in ה, except היה/חיה, which remain outside this release. Regular excludes final ה, initial נ/י, and middle ו/י. This is a classroom scope filter, not a complete linguistic classification: gutturals and הלך/אכל remain eligible and their actual conjugations must independently pass Dicta. Roots need not all belong to the selected group. No three-root hardcoded worksheet path remains.

## Generation and verification

`/api/generate` with `action: "binyan-worksheet"` dispatches to the existing server-only OpenAI adapter. It requests structured candidate forms, meanings and explanations using only eligible uploaded roots. Structural validation checks all requested pairs, persons, roots and model-table coverage.

`lib/binyan-dicta.js` then verifies every distinct model/answer form. Fully pointed candidates are submitted with `keepnikud: true`, `matchpartial: false`, `addmorph: true`, and `freturnfullmorphstr: true`. Pronoun context disambiguates personal/present forms; אָנָּא disambiguates imperatives. The BGU analysis must match root, Paal, tense, person, gender, number and vowelled answer, with no extra prefix/suffix. Dicta's final י root notation is accepted for the corresponding final ה root. Standard modern shared feminine-plural future/imperative forms are accepted. Missing, misaligned, unknown or mismatched analysis fails closed: no unverified worksheet is returned.

Production uses the existing `DICTA_API_KEY` and keyed Nakdan endpoint. Local live checks without a key use Dicta's public endpoint. No secret is sent to the browser. Only form/context text is sent to Dicta, not the workbook or filename. A provider attempt has a 55-second timeout and Dicta a 25-second timeout; the browser allows 110 seconds. Service errors retain the previous successful worksheet.

Dicta verification is not a proof of general linguistic accuracy. Its contextual analysis can reject valid ambiguous forms. English meanings, hints and explanations remain AI-generated and are not validated by Dicta. Review worksheets before classroom use.

## Validation

- `node --test tests/*.test.js`: 145 tests passed.
- `tests/binyan-builder.browser.cjs`: upload, restricted options, single/mixed selection, exact learned marks, print isolation, failures, stale requests and mobile layout passed with mocked generation responses.
- Live Dicta corpus: 71 forms spanning six roots (כתב, שתה, אכל, הלך, בנה, קנה), including complete כתב/שתה paradigms across all five tenses, verified successfully. Captured response: `tests/fixtures/binyan-dicta-paal.json`.
- Negative regressions reject wrong morphology, vowels, root, binyan, prefixes/suffixes, malformed and extra analysis, and provider failures.

## Exercise variety (September 17)

Teachers can select any of four exercise types, all selected initially: circle the correct form, conjugate for a pronoun, complete a sentence, and write an original sentence. The requested total question count is divided across the selected types in contiguous sections. Single-type worksheets remain available. Older API requests without `exercises` retain the conjugation-only format.

Choice distractors are real forms of the same root with a different number (or past versus infinitive), and both choices must pass Dicta. Identical consonantal choices are rejected so the distinction is not dependent on tiny vowel differences. Correct-answer placement alternates. Sentence stems require exactly one blank and cannot repeat the answer. Original-writing questions leave two lines; only the teacher key shows the example sentence, explicitly labeled as one possible answer. Dicta checks the target and alternative verb forms, not the entire sentence's meaning or the student's original writing.

Validation: 150 automated tests passed; browser checks cover all four rendered sections, selection validation, RTL layout and print answer isolation. A live Dicta batch verified the target and alternative forms for a ten-question mixed exercise fixture using אכל and שתה. Browser and generation tests use fixed candidate sentences; live Dicta checks separately exercise morphology validation.

The word-bank exercise and display have been removed. The remaining worksheets use the compact layout with a maximum exercise font size of 14pt on screen and in print. Repeated per-question binyan/root-type labels and translations are omitted; root cues remain where the task needs them. Printed worksheets and answer keys use a 0.75-inch left page margin.
