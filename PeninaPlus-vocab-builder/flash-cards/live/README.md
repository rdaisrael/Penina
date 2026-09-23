# Penina Live — first version

Open Teacher tools on a class webpage using its existing editing code. Start Live Game lets the teacher select published sets, English or Hebrew answer choices, and up to 20 questions. Only current teacher-approved alternatives are eligible.

Students join the lobby by QR/link or six-digit code. Students enter 1–3 letter initials (English or Hebrew supported). Latin letters are displayed in uppercase. The first submitted choice is final. Answers, answer counts by choice, and updated standings are revealed only when the teacher clicks Reveal answer. Each correct answer earns 100 points. Next question advances; End game closes the session. Teachers choose manual pacing or 5, 7, or 10 seconds per question. Timed games display a countdown, reveal the answer for three seconds, then advance automatically. Correct student answers receive a brief fireworks animation after reveal (disabled for reduced motion). There are no teams or time bonuses.

## Local demo

Run `node scripts/preview-live.cjs` from the repository, then open http://localhost:4318. The demo editing code is `demo`. It uses sample Hebrew vocabulary and in-memory storage, with no production reads or writes. Use separate teacher/student tabs on this computer. The localhost QR is not an iPad-accessible public link; production QR links use the site's public origin. Restarting the demo clears its rooms.

## Server

`/api/game-scores?game=live` dispatches to `lib/live-game.js`, avoiding an additional serverless function. Existing Vercel Blob credentials and `VOCABULARY_PAGE_SECRET` (or the existing Blob token as fallback) provide storage and encryption. Rooms expire after four hours; encrypted blobs are not automatically deleted in this version. Keep the secret stable for active rooms.

Questions, student names, answers, and teacher state are AES-GCM encrypted in Blob storage. Browser role tokens are HMAC-signed, room-scoped, expire with the room, and live in session storage; the class editing code is not placed in URLs or browser storage. Immutable state versions prevent two teacher actions advancing simultaneously. Immutable per-student/per-question answers preserve the first choice, including retries and reconnects. The student API omits answer keys until reveal. API reads reconstruct state from storage, not a long-running server process. Clients poll about every two seconds (five when hidden), so a small synchronization delay is expected. Refresh keeps a participant connected within that browser tab.

The first version supports a classroom-sized lobby (100 participants), individual play, and teacher pacing. It has not been production load-tested. The local demo and tests use an in-memory adapter.

## Validation

`node --test tests/live-game.test.js tests/game-scores.test.js tests/student-games.test.js tests/class-games.test.js tests/study-cards.test.js tests/vocabulary-pages.test.js`

QR rendering uses vendored qrcode-generator 1.4.4 by Kazuhiko Arase, MIT-licensed, from https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js.
