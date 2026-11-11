# Penina Knowledge Builder — flashcards

Local entry point: `/PeninaPlus-knowledge-builder/`.

This first stage follows the Suite branding and provides a card editor, electronic flashcards, and paper flashcards. It does not publish sets or connect to Penina Live or Quiz Builder yet.

## Behavior

- Cards always begin with the question. Neither face has a visible question/answer heading.
- An optional uploaded raster picture appears left of the question, including on small screens. A teacher can place one target using a click or keyboard arrows. The target uses image-relative coordinates.
- Clicking a study picture opens a full-window viewer with fit, original-size, and zoom controls, without flipping the card.
- The answer occupies the other face. Additional Information appears in the separate white area below the flashcard, only on the answer side and only when it contains non-whitespace text.
- Paper layouts offer 1 or 4 cards per landscape Letter page, or 2 cards per portrait Letter page. Four-up backs mirror each row for short-edge landscape duplex alignment, including empty cells on the last page. The preview and browser print page orientation change together; print instructions select short-edge flipping for landscape and long-edge flipping for portrait. Each layout fills the printable sheet inside quarter-inch outer margins. Text uses larger layout-specific sizes (up to 36/48/64 pt for 4/2/1 cards), with separate picture-question and additional-information sizes. Pictures fill their column without cropping. Long text scales down only as needed, preserving padding and the separation around additional information; the Print button is disabled if content still does not fit.
- Drafts, including unfinished edits and pictures, are saved in IndexedDB for this browser. Download/Open Draft provides portable JSON copies. No server writes or external requests are made by this app.

## Data

The draft has `format: "penina-knowledge-cards"`, `version: 1`, `title`, and `cards`. Each card has a stable `id`, `question`, `answer`, `additionalInformation`, and optional `picture`. A picture contains a raster data URL, `alt`, and optional `target: {x, y}` in the range 0–1. This leaves question and answer fields distinct for future integrations.

## Local validation

Run `node --test tests/knowledge-cards.test.js tests/study-cards.test.js tests/asset-versioning.test.js` from the repository.

Browser checks covered picture upload and target placement, picture enlargement at original resolution, question-first navigation, conditional information outside the card, 1/2/4-up layouts, draft download/import, restoration after reload, desktop and mobile widths, and browser error logs. Physical printer alignment has not been tested.

To preview locally, run `python3 -m http.server 4320 --bind 127.0.0.1` from the repository and open `http://127.0.0.1:4320/PeninaPlus-knowledge-builder/`.
