# Penina Knowledge Builder — flashcards

Local entry point: `/PeninaPlus-knowledge-builder/`.

The app follows the Suite branding with four stages: Add & Edit Cards, Review Flashcards, Create Practice Activities, and Share. Paper flashcards remain available from Review and Share. The student practice view provides a multiple-choice activity. Published knowledge lists can also be selected alongside vocabulary wordlists in class Gamify, Penina Live, and Quiz Builder.

## Behavior

- Cards always begin with the question. Neither face has a visible question/answer heading, including combined study lists. The standalone student card uses the freed heading space for a taller content area; both wording and pictures start higher, pictures have a wider column and a taller initial display, and longer wording has more room before text fitting reduces its size. Screen-reader side descriptions remain available.
- An optional uploaded raster picture appears left of the question, including on small screens. A teacher can place up to five targets using a click or keyboard arrows, select an individual target to move or remove, and add more with Add Target. One target uses the original crosshair symbol; two to five use A–E inside the circles. Removing targets relabels the remaining targets, returning to the crosshair when one remains. Targets use image-relative coordinates across flashcards, enlarged pictures, print, knowledge sheets/PDFs, spreadsheets, games, Live, and imported quizzes.
- Picture upload appears before Question. **Reuse a Picture** offers one thumbnail per distinct picture already used in the current set, including restored or opened drafts. Reusing copies its description and starts with no targets; each question can have its own description and targets without changing other cards.
- Clicking or tapping a study picture opens a centered pop-out at 1.5× its displayed size; further clicks enlarge it to 2× and then 3×, always capped to fit the screen without scrolling. A “Click to enlarge further” hint appears while another enlargement is available. At the maximum, further picture clicks keep it open at the same size. Click the dimmed background, the close button, or press Escape to return; reopening starts at 1.5× and keyboard focus returns to the original picture without flipping the card. All target labels remain attached to their locations. There are no sliders or zoom toolbars.
- The answer occupies the other face. Additional Information appears in the separate white area below the flashcard, only on the answer side and only when it contains non-whitespace text. Its text follows its detected reading direction: left-aligned for LTR text and right-aligned for RTL text, including practice and paper cards.
- Combined vocabulary/Knowledge e-flashcards share the existing 323 px card and 160 px context/information frames. Long Knowledge questions, answers, pictures, and Additional Information scroll inside those frames, keeping navigation and rating buttons in place through card changes and flips. Knowledge text stays at 24 px, with 17 px Additional Information. Each new face starts at the top of its reading area. The vocabulary text-fitting behavior remains available within the same fixed frame.
- Paper layouts offer 1 or 4 cards per landscape Letter page, or 2 cards per portrait Letter page. Four-up backs mirror each row for short-edge landscape duplex alignment, including empty cells on the last page. The preview and browser print page orientation change together; print instructions select short-edge flipping for landscape and long-edge flipping for portrait. Each layout fills the printable sheet inside quarter-inch outer margins. Text uses larger layout-specific sizes (up to 36/48/64 pt for 4/2/1 cards), with separate picture-question and additional-information sizes. Pictures fill their column without cropping. Long text scales down only as needed, preserving padding and the separation around additional information; the Print button is disabled if content still does not fit.
- **New List** beside Save/Open Draft asks “Clear the current draft and start a new list?” with Cancel and Start New. Start New clears the title, cards, pictures, practice answers, and unfinished edits, saves the empty browser draft, and focuses the title. Published lists remain saved. Save Draft first to keep a copy of unfinished work.
- Drafts, including unfinished edits and pictures, are saved in IndexedDB for this browser. Save/Open Draft provides portable JSON copies. Teacher-requested distractor generation and class-page publishing use the authenticated server APIs. Draft editing and flashcard review remain local.

## Data

The draft has `format: "penina-knowledge-cards"`, `version: 1`, `title`, and `cards`. Each card has a stable `id`, `question`, `answer`, `additionalInformation`, optional `picture`, and optional `distractors.english` / `distractors.hebrew` arrays of four strings. A picture contains a raster data URL, `alt`, and optional `target: {x, y}` in the range 0–1. Pictures with multiple targets also include an ordered `targets` array of up to five coordinate objects; `target` mirrors the first coordinate for backward compatibility. Existing single-target drafts still open. This leaves question and answer fields distinct for future integrations.

## Local validation

Run `node --test tests/knowledge-cards.test.js tests/study-cards.test.js tests/asset-versioning.test.js` from the repository.

Browser checks covered picture upload and target placement, picture enlargement that fits the screen, question-first navigation, conditional information outside the card, 1/2/4-up layouts, draft download/import, restoration after reload, desktop and mobile widths, and browser error logs. Physical printer alignment has not been tested.

`tests/mixed-flashcards-layout.browser.cjs` loads the actual combined-card HTML
with synthetic vocabulary and Knowledge cards and blocks external requests. It
compares card, context, navigation, rating, and page positions at six phone,
tablet, laptop, and landscape sizes across both faces and card orders. It also
checks long-content scrolling without an accidental flip, readable Knowledge
text, picture targets, ratings, and reset. The long-card layout assertion failed
before the fixed-frame repair. `tests/study-cards-layout.browser.cjs` separately
checks the existing vocabulary-only layout and text fitting.

To preview locally, run `python3 -m http.server 4320 --bind 127.0.0.1` from the repository and open `http://127.0.0.1:4320/PeninaPlus-knowledge-builder/`.

## Practice and sharing

- Generate English or Hebrew distractors in batches of up to eight questions. Only empty or explicitly selected cells are sent for generation. Validate the complete response before changing the editor; failures leave existing answers intact. Teachers can also enter answers manually.
- Save Answers applies the correct answer and distractors to the draft. Navigation away from Practice saves valid pending edits. Changing a question or correct answer invalidates its old distractors; changing the correct answer in Practice also invalidates the other language's distractors.
- Share provides a printable knowledge sheet, XLSX download (including pictures, target coordinates and distractors), JSON draft download, and paper flashcards.
- Existing teacher-owned class pages are listed and created through `/api/vocabulary-pages`. Knowledge sets use `/api/flashcard-sets?kind=knowledge` and separate `knowledge-cards/<page>/` JSON records. Mutations require Vocabulary Builder access, the signed-in page owner, and the existing Penina origin check. Generation requires signed-in Vocabulary Builder access.
- Class pages show vocabulary wordlists first, followed by a small gap and a Knowledge Lists section. Both sections use checkboxes for temporary combined flashcards, including knowledge-only or mixed selections. Their cards share Flashcards and Sheets columns with View and Print/PDF actions; the original Download and Print links remain hidden, and card counts are omitted. Print/PDF uses the existing print flow so students can print or save as PDF. Shared class-page assets apply this layout to existing and future pages. Combining preserves question pictures and targets, additional information, and both saved distractor banks, alongside vocabulary translations and context. Knowledge-sheet PDF downloads and printing retain pictures and marked locations. The published/downloaded student app embeds its data, scripts, styling and branding; it does not read or write the teacher's browser draft. It provides flashcards, a knowledge sheet, paper cards and practice for languages with four valid saved distractors.
- Publishing is limited to 3.5 MB per request to stay below the request-body limit. Larger sets remain editable/downloadable as drafts; use smaller images or split the set to publish it.

## Additional validation

Run `node --test tests/knowledge-cards.test.js tests/knowledge-sharing.test.js tests/study-cards.test.js tests/vocabulary-pages.test.js tests/teacher-apps.test.js tests/asset-versioning.test.js`.

`node scripts/preview-knowledge.cjs` serves a local-only demo at `http://127.0.0.1:4321/PeninaPlus-knowledge-builder/`. Its account access, AI responses, and published storage are mocked in memory. It never contacts production services. Use it to review Practice, Share, and student class-page behavior without publishing real content.

The combined regression run passes 67 tests. Local mock browser checks also cover English/Hebrew generation, preserving manual edits during selective regeneration, duplicate-answer rejection, saved draft restoration, spreadsheet content and embedded pictures, class-page creation/publishing, student practice and sheets, and vocabulary-before-knowledge ordering with a 24 px gap. Practice and Share have no horizontal overflow at a narrow mobile width. Actual AI quality and live storage were not exercised.

## Mixed study lists

November 17 Live touch repair: a local browser reproduction showed that starting a
scroll on an answer submitted that answer immediately through `pointerdown`.
The first answer then locked, so a later intended tap could not change it. Live
now uses native completed button clicks, as the study quiz does; routine polls
already preserve answer buttons while a finger is down. Knowledge questions use
22–28 px reading text and 18–22 px choices, following the existing Knowledge quiz
scale instead of Live's large single-word vocabulary style. Saved question kind
is passed to both roles; long/formatted questions in older rooms also get the
reading style.

`tests/live-knowledge.browser.cjs` exercises the actual Live client and handler
with in-memory storage and external requests blocked. Phone and tablet checks
cover text-only and pictured questions, formatting, scrolling without answering,
refreshing during a tap, stable layout on selection/save, and correct answer
mapping/scoring with 1–5 saved distractors. The scroll assertion failed before
the repair and passes afterward. This confirms the local interaction defect;
it does not establish the cause of every classroom report or exercise production
network/storage latency. Four older quiz/matching tests also now load the real
shared question renderer, resolving their missing-function failures.

The subsequent Live answer audit reproduced four more browser failures: a
temporary refresh error disabled an otherwise open answer; correcting an early
local countdown expiry did not re-enable buttons; a classmate joining could
replace a button during a tap; and the preceding question's Incorrect overlay
could remain over a quickly advanced question. The client now shares one answer
eligibility check between drawing, clock updates, and submission. Temporary
refresh failures leave eligible answers available while reconnection continues;
paused, expired, answered, and unavailable games stay locked. Participant counts
and late score/streak updates are patched without replacing active buttons.
The previous Incorrect overlay is cleared on question changes, as Gamify clears
its previous mistake overlay when changing games/rounds. An older snapshot also
no longer stops the polling loop; that failure has a targeted client regression.

`tests/live-answer-races.browser.cjs` reproduces these cases on phone/tablet
viewports using the actual client and handler with in-memory storage, then checks
that the submitted choice receives the correct score. It also verifies that
expired access cannot submit. `tests/live-touch.test.js` and
`tests/live-game.test.js` cover continuing after an older response and maintaining
answer locks through clock corrections. Server answer ordering, first-choice
immutability, and receipt-time cutoffs are unchanged. These checks do not verify
classroom connectivity or the factual correctness of teacher-supplied choices.

Live's student layout compacts the header, streak/countdown row, and answer
padding. Repeated class/game details remain available to screen readers, while
the decorative footer is omitted during a round. Vocabulary and Knowledge use
the same question, answer, and result spaces: full-width answer rows on narrow
phones and two columns on wider screens. Short landscape screens place the
question beside the choices. Reading sizes stay consistent across card types.
Long questions, pictures, and answer text scroll inside their reserved spaces,
so they do not move the answer buttons. Polls, selection, save acknowledgements,
and reveals preserve those reading positions; a new question starts at the top.
Results, vote counts, bonuses, and connection errors do not add space above the
answers. On classroom screens, the teacher's responses/standings sidebar keeps
the same column width before and after reveal.

`tests/live-responsive.browser.cjs` checks normal English/Hebrew questions and
long passages at ten viewport sizes, including small phones, both iPad
orientations, laptops, and landscape phones. It verifies visible normal choices,
readable text, tap sizes, scrolling, rotation, keyboard activation, enlarged
content, and the teacher's iPad layout with its join QR. It also compares exact
question/answer positions across mixed rounds, saves, reveals, bonuses, and
connection errors, and checks that scrolling long answer text does not select
it. These are local Chromium viewport checks, not physical-device or production
verification.

Gamify reserves reading areas within each of its seven games, with consistent
question fonts and scrollable long content. Matching tiles keep their row sizes;
Connect the Words retains dot dragging while allowing the text to scroll. The
game dialog and progress area keep their heights, and Quick Quiz no longer
scrolls back to its title when advancing. Existing flight, falling targets, and
other gameplay motion remain. `tests/gamify-layout.browser.cjs` compares
vocabulary, Knowledge, and long
question/answer layouts for all seven games at phone, tablet, and laptop widths,
checks longer progress counts and internal touch scrolling, and advances an
actual mixed Quick Quiz while scrolled.

Gamify input/grading audit: both matching games compare canonical Unicode and
the whitespace actually displayed, while preserving case, punctuation and
Hebrew vowel marks. Equivalent questions are kept out of the same matching
batch. Connect the Words ties each drag to its initiating pointer, cancels on
lost capture, and suppresses its trailing click without disabling keyboard
selection. Flappy and Snowblaster use completed clicks/taps for their play-area
actions so reading a long answer does not flap or spend a blast. Snowblaster
labels have a bounded, scrollable height; Flappy's overflowing labels keep their
beginning accessible. Arcade flight, aiming, collision and scoring rules remain.

`tests/gamify-input.browser.cjs` reproduced incorrect grading for canonically
identical answers, an unrelated pointer ending a drag, scrolling triggering a
flap, and a 1,220px Snowblaster answer inside a 510px play area before the fixes.
It checks all seven games at phone, tablet and laptop sizes, native answer taps,
scroll/cancel gestures, keyboard selection, matching drags, mixed-card retries,
and stale feedback after reopening. It uses local generated HTML and blocks
external requests. Animations are stepped deterministically; test-only hooks
reach Flappy collision and Snowblaster recharge/hit states without playing full
rounds. These checks verify the reproduced code paths, not physical iOS/Android
devices, live production behavior, or the correctness of teacher-authored answers.

Class Teacher tools includes both vocabulary and knowledge lists in the Live selector and Student Exercises inclusion/emphasis controls. Normal, 2× and 3× weights apply to either type. Gamify combines eligible cards in the chosen answer language. Live validates every selected list and names any list without valid saved choices instead of silently omitting it. Replay settings can switch between or mix list types.

All seven Gamify games and both Live screens retain knowledge pictures and their image-relative target. Questions use the original question and correct answer, with only the teacher's saved distractors. The source publication stays unchanged. Knowledge cards need one to five valid saved distractors in the chosen language; vocabulary cards need four.

Quiz Builder's saved-list chooser includes both types. Select the knowledge distractor language before import; both saved language banks remain in the draft, and the review table can switch between them per question. Editing a knowledge question or answer clears its previously reviewed distractors. Source pictures, targets and original wording survive question generation, draft save/load, duplication and student preview. Import does not call AI.

Pictured questions use individual written-answer, multiple-choice, multiple-answer or fill-in-the-blank formats. Matching supports groups of 4–6 unpictured questions in one language; alphabetical ordering applies to vocabulary. Unavailable formats are reported in the coverage preview. Multiple answers still requires teacher-entered additional correct answers. The combined source supports up to 50 items; quiz answers/choices are limited to 500 characters and knowledge prompts to 5,000. Quiz image data is limited to 2.5 million characters in each source table and question set; oversized requests show an error without dropping pictures or changing the draft.

Local regression: `node --test tests/*.test.js`. `tests/mixed-study-lists.browser.cjs` runs a temporary localhost server with in-memory storage and synthetic teacher/student sessions. It checks all seven games at desktop/mobile widths, mixed selection, quiz import/language selection/generation/save/reload/preview, and Live teacher/student pictures. It makes no production requests.

Local library regression coverage: `node tests/knowledge-library.browser.cjs` (requires Playwright/Chromium; `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` can point to an installed runtime). All API/storage responses use in-memory fixtures, and external browser requests are blocked.

Published knowledge flashcards share the vocabulary viewer’s `studyStyles()` and text-fitting helper. Their page shell, background, sidebar, outer card/context sizes and shared controls match wordlists; builder branding, credits and top navigation are omitted. Knowledge questions keep their picture on the left (with enlargement and its target), their answer on the reverse, and additional information below the answer. Cards always start with the question; there are no flip-order settings. Flipping still reveals the answer. Saved practice and the existing 1/2/4-card print layouts remain available. The authoring page keeps its existing workflow.

Picture reuse regression: `node tests/knowledge-picture-reuse.browser.cjs` (uses the same `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` overrides). Covers repeated reuse, independent targets/descriptions, duplicate thumbnails, keyboard selection, desktop/mobile layout, draft persistence/export/import, removal, and new-list reset. All requests stay local.

Multiple-target regression: `node --test tests/knowledge-targets.test.js` and `node tests/knowledge-picture-targets.browser.cjs` (same Playwright/Chrome overrides). Covers the five-target limit, A–E labeling, independent movement/removal, reversion to a single crosshair, draft round trips, reuse independence, student views, paper cards, sheets, and spreadsheet coordinates. `tests/mixed-study-lists.browser.cjs` also verifies all five labels across games, Live, and quiz import/save/student preview.

Picture pop-out regression: `node tests/knowledge-picture-popup.browser.cjs` (same Playwright/Chrome overrides). Verifies the 1.5×/2×/3× steps, screen-size limits on desktop and phones in both orientations, hint visibility, wide/tall pictures, target positions, dismissal, reopening, keyboard activation/focus return, resizing, reduced motion, and author/student views. All requests stay local.


## Card editing and formatting

- Previous Card and Next Card sit between Save Card and Delete Card. They save valid pending edits before navigating, stop at the first/last card, and keep the current card open if required text or a picture upload is incomplete. From the empty Add Card form, Previous Card returns to the last saved card.
- Question, Answer, and Additional Information support selected-text bold (also Ctrl/Cmd+B), automatic/LTR/RTL paragraph direction, and left/center/right paragraph alignment. Direction/alignment applies to the selected paragraphs or the paragraph containing the caret.
- Drafts keep plain strings for matching and generation, with optional validated `textFormatting` paragraph/run metadata. Formatting-only edits preserve reviewed distractors. Pasted/dropped text is plain text; stored HTML is never accepted.
- Formatting survives browser drafts, JSON downloads, study cards, paper cards, knowledge sheets/PDFs, and combined cards. XLSX exports preserve bold runs and use the first paragraph's direction/alignment for each cell.
- Gamify and Penina Live carry question formatting through `questionFormatting`. Answer choices use consistent plain-text styling; answer formatting is not sent in Live question snapshots. Existing published lists must be updated with the edited cards before future games can use their formatting.
- Local regression coverage: `tests/knowledge-formatting.test.js` and `tests/knowledge-editing.browser.cjs`, alongside the existing knowledge, study-card, and Live tests. Browser checks block external requests.
