# PeninaPlus Binyan Builder

Route: `/PeninaPlus-Binyan-Builder/`. Added to the suite home page.

Reuses the Reader's local ExcelJS library, exact `VocabularyUpload.readExcel` parser, downloadable template and sample, PeninaPlus logo and Hebrew fonts. No workbook or student filename is sent to the API. Roots and learned form pairs are extracted locally; only these and worksheet settings are submitted. Nouns/adjectives are recognized but are not used for standalone conjugation exercises. Category rows and root rows are independent.

Learn mode accepts up to eight exact binyan/root-group and tense/form pairs, with a model paradigm and English explanation per pair plus guided questions. Practice mode is restricted on both client and server to exact pairs marked X in the upload, with no model tables or hints. Both produce 6–30 questions and a separate answer key. Past/future use ten persons, present four gender/number forms, imperative four second-person forms, infinitive/verbal noun one form. The Reader's thirteen root groups are retained; regular Pual and Hufal are available for new learning, limited to past/present/future. The Reader template currently has no Pual/Hufal rows, so these cannot be marked learned for Practice without a future coordinated template/parser update.

`/api/generate` with `action: "binyan-worksheet"` dispatches to `lib/binyan-handler.js` and uses the existing server-only OpenAI adapter and `OPENAI_API_KEY` / Reader model settings. No new dependency or key is required. It requests strict structured JSON with one 55-second provider attempt within the existing generation function. The browser aborts after 70 seconds. This shares the existing endpoint to stay within the Vercel Hobby function-count limit. Provider failures, invalid structures, wrong pair/person assignments, missing coverage, unknown roots and missing Hebrew vowel marks fail without replacing the last successful worksheet. Settings changes cancel/invalidate in-flight generation. Uploads have their own version guard and clear the old vocabulary before replacement.

The prompt requires attested Modern Hebrew forms and correct root classes, with an explicit failure when uploaded roots cannot support every selection. Structural validation is not an independent Hebrew morphology validator. Teacher review is required for AI-generated forms, explanations and meanings; no claim of general linguistic accuracy is made. A human-reviewed corpus and live generation checks remain necessary. The endpoint deliberately avoids a separate automatic niqqud pass that could change an isolated conjugated form.

Student worksheet, answer key, or both can be printed / saved as PDF via the browser. Answer keys start on a new page. Output is frozen to the successful request; edited settings leave the previous worksheet visible and labeled. Model/question text is escaped before rendering.

Checks: `node --test tests/binyan-builder.test.js tests/vocabulary-upload.test.js`; browser checks use `tests/binyan-builder.browser.cjs` with `PLAYWRIGHT_MODULE` and optional `CHROME_EXECUTABLE`. Browser generation responses are fixtures, explicitly not a live AI evaluation.


## September 16 audit fixes

Reproduced the user's workbook state in the live UI: three roots (אכל, שתה, הלך), no learned X-marked pairs, a visible default binyan/tense but a disabled Build button. A live API request with those roots, the previous default פעל שלם|עבר and 12 questions returned HTTP 502 with “No suitable verbs”. Prior tests used regular sample roots and explicit Add actions, so they missed this flow.

Single-pattern mode now uses the visible dropdown selection directly. Mixing is explicit and starts with the current selection; its added list is the exact generation list. Selection changes invalidate pending requests. Disabled-button reasons now appear beside Build, including too many pairs for the question count and missing learned marks. Learn does not require learned marks; Practice preserves exact uploaded mastery restrictions.

Learn defaults to Paal with **All root types**, and each of the seven binyanim has that option. Specific Reader root-group choices remain available. This permits weak and irregular roots without falsely labeling them as strong roots. Passive binyan options still exclude imperative/infinitive/verbal-noun forms. The generator distinguishes broad binyan selections from specific root classes, and reports unsupported pairs by name where supplied. Structural checks still do not establish linguistic accuracy.

Regression checks now cover the actual roots-only workbook shape, immediately building without Add, changing the visible tense, single/mixed transitions, and the question-count error. No changes were made to the shared Reader Excel parser or to uploaded mastery marks.
