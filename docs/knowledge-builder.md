# Penina Knowledge Builder — flashcards

Local entry point: `/PeninaPlus-knowledge-builder/`.

The app follows the Suite branding with four stages: Add & Edit Cards, Review Flashcards, Create Practice Activities, and Share. Paper flashcards remain available from Review and Share. The student practice view provides a multiple-choice activity. Published knowledge lists can also be selected alongside vocabulary wordlists in class Gamify, Penina Live, and Quiz Builder.

## Behavior

- Cards always begin with the question. Neither face has a visible question/answer heading.
- An optional uploaded raster picture appears left of the question, including on small screens. A teacher can place one target using a click or keyboard arrows. The target uses image-relative coordinates.
- Clicking a study picture opens a full-window viewer with fit, original-size, and zoom controls, without flipping the card.
- The answer occupies the other face. Additional Information appears in the separate white area below the flashcard, only on the answer side and only when it contains non-whitespace text.
- Paper layouts offer 1 or 4 cards per landscape Letter page, or 2 cards per portrait Letter page. Four-up backs mirror each row for short-edge landscape duplex alignment, including empty cells on the last page. The preview and browser print page orientation change together; print instructions select short-edge flipping for landscape and long-edge flipping for portrait. Each layout fills the printable sheet inside quarter-inch outer margins. Text uses larger layout-specific sizes (up to 36/48/64 pt for 4/2/1 cards), with separate picture-question and additional-information sizes. Pictures fill their column without cropping. Long text scales down only as needed, preserving padding and the separation around additional information; the Print button is disabled if content still does not fit.
- **New List** beside Download/Open Draft asks “Clear the current draft and start a new list?” with Cancel and Start New. Start New clears the title, cards, pictures, practice answers, and unfinished edits, saves the empty browser draft, and focuses the title. Published lists remain saved. Download Draft first to keep a copy of unfinished work.
- Drafts, including unfinished edits and pictures, are saved in IndexedDB for this browser. Download/Open Draft provides portable JSON copies. Teacher-requested distractor generation and class-page publishing use the authenticated server APIs. Draft editing and flashcard review remain local.

## Data

The draft has `format: "penina-knowledge-cards"`, `version: 1`, `title`, and `cards`. Each card has a stable `id`, `question`, `answer`, `additionalInformation`, optional `picture`, and optional `distractors.english` / `distractors.hebrew` arrays of four strings. A picture contains a raster data URL, `alt`, and optional `target: {x, y}` in the range 0–1. This leaves question and answer fields distinct for future integrations.

## Local validation

Run `node --test tests/knowledge-cards.test.js tests/study-cards.test.js tests/asset-versioning.test.js` from the repository.

Browser checks covered picture upload and target placement, picture enlargement at original resolution, question-first navigation, conditional information outside the card, 1/2/4-up layouts, draft download/import, restoration after reload, desktop and mobile widths, and browser error logs. Physical printer alignment has not been tested.

To preview locally, run `python3 -m http.server 4320 --bind 127.0.0.1` from the repository and open `http://127.0.0.1:4320/PeninaPlus-knowledge-builder/`.

## Practice and sharing

- Generate English or Hebrew distractors in batches of up to eight questions. Only empty or explicitly selected cells are sent for generation. Validate the complete response before changing the editor; failures leave existing answers intact. Teachers can also enter answers manually.
- Save Answers applies the correct answer and distractors to the draft. Navigation away from Practice saves valid pending edits. Changing a question or correct answer invalidates its old distractors; changing the correct answer in Practice also invalidates the other language's distractors.
- Share provides a printable knowledge sheet, XLSX download (including pictures, target coordinates and distractors), JSON draft download, and paper flashcards.
- Existing teacher-owned class pages are listed and created through `/api/vocabulary-pages`. Knowledge sets use `/api/flashcard-sets?kind=knowledge` and separate `knowledge-cards/<page>/` JSON records. Mutations require Vocabulary Builder access, the signed-in page owner, and the existing Penina origin check. Generation requires signed-in Vocabulary Builder access.
- Class pages show vocabulary wordlists first, followed by a small gap and a Knowledge Lists section. Both sections use checkboxes for temporary combined flashcards, including knowledge-only or mixed selections. Their cards share Flashcards and Sheets columns with View, Download (PDF for sheets), and Print actions; card counts are omitted. Combining preserves question pictures and targets, additional information, and both saved distractor banks, alongside vocabulary translations and context. Knowledge-sheet PDF downloads and printing retain pictures and marked locations. The published/downloaded student app embeds its data, scripts, styling and branding; it does not read or write the teacher's browser draft. It provides flashcards, a knowledge sheet, paper cards and practice for languages with four valid saved distractors.
- Publishing is limited to 3.5 MB per request to stay below the request-body limit. Larger sets remain editable/downloadable as drafts; use smaller images or split the set to publish it.

## Additional validation

Run `node --test tests/knowledge-cards.test.js tests/knowledge-sharing.test.js tests/study-cards.test.js tests/vocabulary-pages.test.js tests/teacher-apps.test.js tests/asset-versioning.test.js`.

`node scripts/preview-knowledge.cjs` serves a local-only demo at `http://127.0.0.1:4321/PeninaPlus-knowledge-builder/`. Its account access, AI responses, and published storage are mocked in memory. It never contacts production services. Use it to review Practice, Share, and student class-page behavior without publishing real content.

The combined regression run passes 67 tests. Local mock browser checks also cover English/Hebrew generation, preserving manual edits during selective regeneration, duplicate-answer rejection, saved draft restoration, spreadsheet content and embedded pictures, class-page creation/publishing, student practice and sheets, and vocabulary-before-knowledge ordering with a 24 px gap. Practice and Share have no horizontal overflow at a narrow mobile width. Actual AI quality and live storage were not exercised.

## Mixed study lists

Class Teacher tools includes both vocabulary and knowledge lists in the Live selector and Student Exercises inclusion/emphasis controls. Normal, 2× and 3× weights apply to either type. Gamify combines eligible cards in the chosen answer language. Live validates every selected list and names any list without valid saved choices instead of silently omitting it. Replay settings can switch between or mix list types.

All seven Gamify games and both Live screens retain knowledge pictures and their image-relative target. Questions use the original question and correct answer, with only the teacher's saved distractors. The source publication stays unchanged. A knowledge list needs four valid saved distractors in the chosen language to participate in games.

Quiz Builder's saved-list chooser includes both types. Select the knowledge distractor language before import; both saved language banks remain in the draft, and the review table can switch between them per question. Editing a knowledge question or answer clears its previously reviewed distractors. Source pictures, targets and original wording survive question generation, draft save/load, duplication and student preview. Import does not call AI.

Pictured questions use individual written-answer, multiple-choice, multiple-answer or fill-in-the-blank formats. Matching supports groups of 4–6 unpictured questions in one language; alphabetical ordering applies to vocabulary. Unavailable formats are reported in the coverage preview. Multiple answers still requires teacher-entered additional correct answers. The combined source supports up to 50 items; quiz answers/choices are limited to 500 characters and knowledge prompts to 5,000. Quiz image data is limited to 2.5 million characters in each source table and question set; oversized requests show an error without dropping pictures or changing the draft.

Local regression: `node --test tests/*.test.js`. `tests/mixed-study-lists.browser.cjs` runs a temporary localhost server with in-memory storage and synthetic teacher/student sessions. It checks all seven games at desktop/mobile widths, mixed selection, quiz import/language selection/generation/save/reload/preview, and Live teacher/student pictures. It makes no production requests.

Local library regression coverage: `node tests/knowledge-library.browser.cjs` (requires Playwright/Chromium; `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` can point to an installed runtime). All API/storage responses use in-memory fixtures, and external browser requests are blocked.

Published knowledge flashcards share the vocabulary viewer’s `studyStyles()` and text-fitting helper. Their page shell, background, sidebar, fixed card/context sizes and controls match wordlists; builder branding, credits and top navigation are omitted. Knowledge questions keep their picture on the left (with enlargement and its target), their answer on the reverse, and additional information below the answer. Question/answer flip order, saved practice and the existing 1/2/4-card print layouts remain available. The authoring page keeps its existing workflow.
