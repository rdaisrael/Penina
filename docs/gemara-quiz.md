# Gemara 6 — Quiz WL #2

Student page: `/Penina-Quizzes/gemara-6-wl-2/`. Teacher tools: `/Penina-Quizzes/gemara-6-wl-2/teacher.html`.

All 14 questions and the Talmud image are hosted by Penina. No student request to BookWidgets or a third-party font service is required. The extra-credit annotation boxes are replaced with A/B markers and separately labelled written answers. The original 12 regular points and 4 possible extra-credit points are retained. No countdown is copied: the shared widget displayed a 16-hour timer, which has not been treated as an intended classroom time limit.

Assign the student link using the teacher page's Share to Google Classroom button, or paste the link into an assignment. Students submit in Penina, can download an HTML answer copy and attach it to the Classroom assignment, then turn in the assignment in Classroom. Link sharing does not transfer grades. Use teacher tools to review answers or export CSV; grade the assignment manually in Classroom. The public quiz link does not expose the author's answer key, so no automatic answer key has been assumed.

Reports use `CARD_PUBLISH_KEY_SIXTH`, the existing Sixth Grade publishing password. Storage uses the existing `BLOB_READ_WRITE_TOKEN`. Each immutable submission has a random receipt ID. Student names, email addresses, and answers are encrypted with AES-256-GCM before being written to the public Blob store. The encryption key uses `QUIZ_STORAGE_SECRET`, falling back to `VOCABULARY_PAGE_SECRET`, then the Blob token. Preserve this key across token rotations; before rotating a fallback token, set `QUIZ_STORAGE_SECRET` to its old value. Raw Blob URLs and encryption keys are not exposed by this API.

The assessment handler shares `/api/game-scores?game=assessment` to avoid adding a serverless function. Reports require POST with the teacher password; no student records are available through GET. Submissions validate the question schema and choices on the server. Retries with the same receipt ID return acceptance without overwriting the earlier submission. Identity is student-entered, not authenticated through Google; this workaround does not verify roster membership.

Drafts and completed answer copies persist on the student's browser. The completed receipt page has a new-student button to clear the local draft on shared devices. Save answer copy is also available before submission so a storage outage does not prevent students handing work in through Classroom.

Verification: `node --test tests/quiz-submissions.test.js tests/game-scores.test.js`. Check the student and teacher pages on desktop and mobile. Before assigning, verify a real submission is accepted in the deployed storage and appears in the protected report. The school must allow Penina itself; local testing cannot confirm the school's filter rules.
