# PP Quiz builder

Open `/Penina-Quizzes/builder/` from **Build a quiz** on the Penina home page. Sign in with the registered Google teacher account through Teacher tools. The account owns its own library.

Create a quiz title and a 1–1,000 minute time limit or **No time limit**, then add written answer, multiple choice, multiple answers, fill-in-the-blanks, or ordering questions. Each question has a point value and reading direction. For blanks, insert `___`, update the blanks, and select the answer for each position. Repeated answers are allowed for blanks. Ordering uses each item once; position 1 starts at the selected reading-direction edge. Written questions have optional teacher-only model answers. Other question types default to all-or-nothing scoring per question, with optional points per correct response.

**Add question with previous choices** creates a new question using the last question’s choices, type, points, scoring settings, extra-credit setting, and reading direction. The question text and correct answers start blank, and focus moves to the new question. It is available when the last question has choices and the quiz is editable. Choices are copied independently, so editing the new question does not change the previous one. The existing per-question **Duplicate** still copies the full question and answer key.

**Save draft** stores the draft across devices. Unsaved edits are held on the page and a navigation warning protects them; there is no automatic draft save. **Student preview** is practice only and sends no answers. **Publish quiz** freezes a validated snapshot, then opens the way to teacher tools. It does not post an assignment to students. Choose a class and create a Classroom draft, then review and assign it in Classroom. Duplicate a published quiz for changes or a retake; it receives a new ID and separate assignment/submissions.

Students use the existing Google enrollment checks, immutable attempts, server-verified identities, browser answer recovery, and timed quiz flow. Teachers review only quizzes they authored, correct written work in whole-point increments, or half-point increments for questions with **Allow half credit** checked, export CSV, and send completed grades to the linked Classroom assignment. Existing imported quizzes retain their pages and grading rules.

## Implementation and verification

`quiz-builder-model.js` validates question definitions, removes keys from student responses, and grades custom quizzes. `quiz-builder.js` stores encrypted owner-scoped drafts and immutable published snapshots in the existing Blob store. The account handler resolves published custom quiz IDs and creates class-specific assignment URLs. `quiz-custom-submissions.js` scopes attempts, responses, and correction records to each published quiz. All new operations share `/api/game-scores`, so no extra serverless function is added.

No new environment variables or Google permissions are needed. Existing quiz storage encryption secrets must remain stable. Questions and model answers are never embedded in public static files. New quizzes appear in the author's library; existing code-based imported quizzes remain accessible through the original teacher tools.

Run `node --test tests/*.test.js`. The new tests exercise schema validation, all five types, repeated gaps, exact grading, teacher-only writes, cross-origin rejection, owner isolation, encrypted storage, immutable publishing, dynamic assignment links, hidden answer keys, enrollment denial, one submission, corrections/grade transfer, and OAuth return paths. Browser verification uses a local in-memory Blob/Classroom simulator; real cloud persistence and Google Classroom integration need a deployed smoke test.

## Timing, review checkpoint, and class results

A null duration means no deadline, not a very long timer. Students see **No time limit** and must submit manually. Timed quizzes continue to expire normally.

In the builder, **Review checkpoint** selects the question before which the warning page appears (question 2 or later), with an editable message. The checkpoint is not scored or included in the question count. Before confirming, students can return to any earlier question. Confirmation saves and locks the entire preceding section. Each subsequent **Lock answer & next** saves and locks that answer. The final page submits all answers. Published checkpoint settings are immutable like the questions.

Immutable encrypted progress records on the server enforce sequential locks. Reloads and retries restore the same progress; editing browser values or using a stale tab cannot overwrite locked answers or skip the checkpoint. The timer continues on the checkpoint page. At expiry, unfinished work can still submit, preserving any answers already locked. Unlimited quizzes still enforce forward-only navigation.

Teacher tools include a **Results for class** selector and **Load roster & results** refresh. A current paginated Google Classroom roster is matched by verified Google user ID and class ID to student attempts and submissions. Statuses are Not assigned, Not started, In progress, Submitted, or Time expired · not submitted. Teacher practice is excluded. Rosters use names available under the existing roster permission, without requesting additional email scope. A failed roster fetch reports an error rather than showing everyone as not started. Results are snapshots; refresh to see new attempts or submissions.

Question summaries show counts and percentages out of all submissions in the selected results, with separate full-credit, zero-credit, partial-credit, and awaiting-correction columns. Non-submitters do not enter that denominator; former class members' submissions remain in class results. Percentages display a dash for no submissions. Saving a correction refreshes the on-page summary. All-classes results aggregate submissions only; select a class to get its full roster.

**Allow half credit** appears beside each question’s points and defaults to unchecked. Unchecked questions use whole-number point values and teacher marks. Checking it enables 0.5-point increments for both. Unchecking it while the point value is fractional requires changing that value to a whole number before saving. The scoring-mode radio buttons separately control whether automatic credit is per question or per correct response.

**Points apply to:** each question offers **Pts. per total question** (default) and **Pts. per correct response** beside the point value. Per-question scoring awards the configured value only for a complete correct automatic answer. Per-response scoring awards that value for each correct blank, correctly positioned ordering item, or correct selected answer. Multiple-answer questions require exactly the answer-key count of selections (or fewer on timer expiry), preventing selecting every option for full credit. Written and single-choice questions each have one response. Half-point increments are still separately opt-in. Builder totals, student point labels, grading, report totals, and Classroom maximum points use the resulting question maximum. Published quiz scoring remains fixed. Partial automatic results show “Partly correct” after submission.

## Vocabulary question options

Matching questions pair each teacher-entered word or definition with an answer from a word bank. Use **Add word or distractor** to add extra choices and select the correct answer for each item. Choices may be reused. Unused choices are distractors and never earn credit. Scoring can apply to the complete question or each correct match.

Fill-in-the-blank questions use `___` for each blank. **Use a word bank** defaults to checked and supports any number of distractors within the 50-choice limit. Uncheck it for typed answers, then enter the answer key for each blank. Typed answers ignore capitalization and surrounding spaces but otherwise require the entered spelling. Existing published blank questions retain their word banks and grading behavior.

## Generate a quiz from a vocabulary list

Open **Generate a quiz from vocabulary** in the builder. Upload CSV/TSV/text or paste two columns copied from a spreadsheet: word and definition. A header row is optional. CSV definitions containing commas must be quoted. Lists support 2–50 entries (10–15 recommended), with 500 characters per word or definition and a 100 KB import limit.

The editable table includes correct definitions, incorrect definitions for choice/matching questions, and extra words for multiple-answer questions and blank word banks. **Generate distractors** suggests three of each per word. Regenerate one row or all rows; replacement of existing edits requires confirmation. Generation failures leave the existing table untouched. Suggestions need teacher review for semantic correctness. Manual distractors can also be entered, one per line (up to ten in each cell).

Choose 1–100 questions, the formats to include, blank word-bank behavior, and reading direction. All selected formats appear, distributed evenly, so the question count must be at least the number of selected formats. Matching groups count as one question. Ordering sorts vocabulary alphabetically. Written questions ask for a meaning and example sentence; teachers grade them. Longer quizzes reuse vocabulary. Context sentences and distractor suggestions use the existing server-only OpenAI adapter; answer keys and choice banks are constructed from teacher-reviewed vocabulary.

Generation runs in batches of at most ten. No questions are added until all batches finish successfully. Questions append to the current draft, up to the existing 100-question limit. Teachers can name the quiz, edit generated questions/answer keys/points, or add more questions in the regular builder. Save, publish, and Google Classroom assignment use the existing workflow; generation does not publish or assign anything.

Vocabulary tables and settings save in the encrypted owner-scoped draft, survive reload and duplication, and remain out of public published snapshots. Table edits affect future generation, not existing questions. The existing OPENAI_API_KEY and configured model settings are used. Automated tests stub the AI service; live semantic quality and Google Classroom assignment should receive a deployed smoke check.
