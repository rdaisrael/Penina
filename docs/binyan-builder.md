# Penina Binyan Builder

Route: `/PeninaPlus-Binyan-Builder/`.

## Current scope

Learn offers all seven binyanim: קל (פעל), פיעל, הפעיל, התפעל, נפעל, פועל and הופעל, independently of the workbook's learned marks. Each has an All root types selection; the Reader's specific root groups are also available, alongside Regular Pual/Hufal. Supported forms are past, present, future, infinitive and imperative, except Pual/Hufal, which offer only past, present and future. Verbal nouns remain excluded because the tested Dicta noun analysis does not establish their root/binyan relationship.

The shared Reader parser is unchanged. The download uses Reader's current `Vocabulary_By_Category.xlsx`, and uploads accept `.xlsx` and `.xls`, including older Reader workbooks. Practice follows the exact X-marked binyan/root-type/tense squares, on both client and server; it never takes a cross-product of learned binyanim and tenses. Switching from Learn to Practice discards unmarked selections. Unsupported learned marks (verbal nouns) are filtered out of the exercise selector, not treated as a corrupt workbook; all learned forms remain available for assessing context vocabulary. The current Reader template has no Pual/Hufal or All root types rows, so those selections are available in Learn only. Learn needs only roots. Select one visible combination directly or enable mixed practice for up to eight combinations; worksheets have 6–30 questions, model tables in Learn, and a separate printable answer key.

Root eligibility is deterministic. All root types accepts uploaded roots without excluding weak or irregular classes; the generator must choose naturally occurring verbs in the requested binyan, and every actual form must pass Dicta. Specific Lamed hey, hollow, initial-nun and initial-yod groups filter by the corresponding root letters. The existing Paal Regular and Lamed hey filters are preserved, including the היה/חיה exclusion in the specific Paal Lamed hey group. Regular Piel/Pual/Hitpael allow initial נ/י and middle ו/י, which need not be weak in those binyanim. For Regular Kal infinitives specifically, a conservative vetted list in `core.js` overrides the broad filter: only standard לִקְטוֹל forms are eligible. Both lesson and question answers must match the listed fully pointed form (Unicode-normalized), in addition to passing Dicta. No eligible roots produces an actionable error before generation; a small eligible pool may repeat. Roots need not all belong to the selected group.

## Generation and verification

`/api/generate` with `action: "binyan-worksheet"` dispatches to the existing server-only OpenAI adapter. It requests structured candidate forms, meanings and explanations using only eligible uploaded roots. Structural validation checks all requested pairs, persons, roots and model-table coverage.

`lib/binyan-dicta.js` then verifies every distinct model/answer form. Fully pointed candidates are submitted with `keepnikud: true`, `matchpartial: false`, `addmorph: true`, and `freturnfullmorphstr: true`. Pronoun context disambiguates personal/present forms; אָנָּא disambiguates imperatives. The BGU analysis must match root, the selected binyan, tense, person, gender, number and vowelled answer, with no extra prefix/suffix. Dicta's final י root notation is accepted for the corresponding final ה root across binyanim. Standard modern shared feminine-plural future/imperative forms are accepted. Missing, misaligned, unknown or mismatched analysis fails closed: no unverified worksheet is returned.

Production uses the existing `DICTA_API_KEY` and keyed Nakdan endpoint. Local live checks without a key use Dicta's public endpoint. No secret is sent to the browser. Only form/context text is sent to Dicta, not the workbook or filename. The worksheet generator receives the vocabulary lists and selected patterns, while the original workbook remains in the browser. A provider attempt has a 70-second timeout and Dicta a 25-second timeout; the browser allows 110 seconds. Service errors retain the previous successful worksheet.

Dicta verification is not a proof of general linguistic accuracy. Its contextual analysis can reject valid ambiguous forms. English meanings, hints and explanations remain AI-generated and are not validated by Dicta. Review worksheets before classroom use.

## November 16: restore new-binyan learning

Commit `323676537f25cd485c44e157123a111858d8cecb` (September 17, “Limit Binyan Builder to Paal and verify forms with Dicta”) replaced the seven-binyan catalogue with two Paal groups, added a Paal-only generation instruction and hardcoded Paal in the Dicta validator. The shared restriction affected Learn as well as Practice. Tests asserted the restricted catalogue, so they preserved the regression rather than detecting it.

The restored catalogue and selected-binyan verification retain exact marked-square Practice behavior. Regression tests cover all seven unmarked Learn selections, exact Practice squares across binyanim/root types/tenses, passive-tense restrictions, wrong-binyan rejection, and the existing Regular Kal infinitive rule. The expanded morphology tests use explicitly synthetic BGU contract fixtures; the older recorded Paal/infinitive fixtures are also replayed locally. No new live generation, production-site or deployment checks were performed. Dicta's seven label names were cross-checked against its [public wordlist metadata](https://huggingface.co/datasets/dicta-il/wordlist).

Follow-up: Learn's dropdowns now populate on initial load, before a workbook is uploaded. The previous `eligiblePairs()` guard returned an empty list without vocabulary in both modes, disabling all three controls; the browser test missed it because it uploaded the sample first. The regression check now selects every binyan before upload and confirms that root-type/tense selections survive upload. Building still requires uploaded roots. Practice stays unavailable until a workbook supplies its marked squares.

## Validation

- `node --test tests/*.test.js`: 810 tests passed on November 16.
- `tests/binyan-builder.browser.cjs`: all seven Learn options without marks, exact marked-square Practice options, mode switching, upload, single/mixed selection, print isolation, failures, stale requests and mobile layout passed with mocked generation responses. The resize assertion waits for the browser to rescale its worksheet preview.
- Live Dicta corpus: 71 forms spanning six roots (כתב, שתה, אכל, הלך, בנה, קנה), including complete כתב/שתה paradigms across all five tenses, verified successfully. Captured response: `tests/fixtures/binyan-dicta-paal.json`.
- Negative regressions reject wrong morphology, vowels, root, binyan, prefixes/suffixes, malformed and extra analysis, and provider failures.

## Exercise variety (September 17)

Teachers can select any of four exercise types, all selected initially: circle the correct form, conjugate for a pronoun, complete a sentence, and write an original sentence. The requested total question count is divided across the selected types in contiguous sections. Single-type worksheets remain available. Older API requests without `exercises` retain the conjugation-only format.

Choice distractors are real forms of the same root with a different number (or past versus infinitive), and both choices must pass Dicta. Identical consonantal choices are rejected so the distinction is not dependent on tiny vowel differences. Correct-answer placement alternates. Sentence stems require exactly one blank and cannot repeat the answer. Original-writing questions leave two lines; only the teacher key shows the example sentence, explicitly labeled as one possible answer. Dicta checks the target and alternative verb forms, not the entire sentence's meaning or the student's original writing.

Validation: 150 automated tests passed; browser checks cover all four rendered sections, selection validation, RTL layout and print answer isolation. A live Dicta batch verified the target and alternative forms for a ten-question mixed exercise fixture using אכל and שתה. Browser and generation tests use fixed candidate sentences; live Dicta checks separately exercise morphology validation.

The word-bank exercise and display have been removed. The remaining worksheets use the compact layout with a maximum exercise font size of 14pt on screen and in print. Repeated per-question binyan/root-type labels and translations are omitted; root cues remain where the task needs them. Printed worksheets and answer keys use a 0.75-inch left page margin.

## Familiar sentence vocabulary and notes

Generation now retains the workbook's nouns, adjectives, prepositions, adverbs, conjunctions, question words, and expressions alongside roots and learned forms. The prompt prioritizes these words when writing sentence-completion stems and teacher example sentences. This is a generation preference, not a guarantee of an entirely mastered sentence; sparse lists may still need unfamiliar context words.

Teachers can choose vocabulary notes at the bottom of each page (the default), at the end, or no notes. Placement can change without another generation request. Notes contain the Hebrew supporting word or phrase and an English gloss; the missing verb is excluded from analysis. Writing examples and their notes appear only in the teacher key. Repeated notes are deduplicated within each document and repeated on a page when needed there.

The browser and server reuse Reader's `validateAnalysis` and `buildResult` to check word alignment, uploaded matches, pronouns, expressions, and learned context-verb forms. A familiar root alone does not establish mastery of an unlearned conjugation. Missing/misaligned analysis fails before returning a worksheet. Glosses and linguistic matches are AI-generated and still need teacher review; Dicta continues to verify target verb forms, not translations or complete sentence semantics.

Pagination measures questions and notes together at the existing Letter size, repeats exercise headings on continuation pages, and reflows after a font or note-placement change. Long exceptional teaching blocks flow instead of clipping. Local validation covers all vocabulary sheets, familiar/unfamiliar words, expressions, invalid analysis, answer isolation, 30-question pagination, note placement, font changes, and mobile width. The full unit suite passed 738 tests; local browser checks use mocked generation, and the two-page PDF was inspected without contacting production or live AI services.

## Shared Reader infinitive rule

The Reader imports the same vetted infinitive lookup in the browser and on the server. In root-based vocabulary modes, Regular Kal infinitive mastery requires a listed root and matching infinitive spelling (and matching vowels when pointed). Both workbook labels and checkbox labels with parenthetical model roots are recognized. Nonstandard forms become unmastered and receive ordinary footnotes, including when the provider incorrectly reports them as mastered. The check runs again after vocalization. Other separately learned categories, complete-word vocabulary and explicitly learned expressions retain their existing behavior.
