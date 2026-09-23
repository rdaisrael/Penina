# Penina Live — first version

Open Teacher tools on a class webpage using its existing editing code. Start Live Game lets the teacher select published sets, English or Hebrew answer choices, and up to 20 questions. Only current teacher-approved alternatives are eligible.

Students join the lobby by QR/link or six-digit code. Students enter 1–3 letter initials (English or Hebrew supported). Latin letters are displayed in uppercase. The first submitted choice is final. Answers, answer counts by choice, and updated standings are revealed only when the teacher clicks Reveal answer. Each correct answer earns 100 points. Next question advances; End game closes the session. Teachers choose manual pacing or 5, 7, or 10 seconds per question. Timed games display a countdown, reveal the answer for two seconds, then advance automatically. Correct student answers receive a brief fireworks animation after reveal (disabled for reduced motion). There are no teams or time bonuses.

## Local demo

Run `node scripts/preview-live.cjs` from the repository, then open http://localhost:4318. The demo editing code is `demo`. It uses sample Hebrew vocabulary and in-memory storage, with no production reads or writes. Use separate teacher/student tabs on this computer. The localhost QR is not an iPad-accessible public link; production QR links use the site's public origin. Restarting the demo clears its rooms.

## Server and Supabase setup

`/api/game-scores?game=live` dispatches to `lib/live-game.js`. Apply `supabase/live-game.sql` to the Supabase project, then set these Vercel production environment variables before deployment:

- `PENINA_SUPABASE_URL`: the HTTPS project URL.
- `PENINA_SUPABASE_SECRET_KEY`: a server-only secret API key; never put it in source or browser code.
- `PENINA_SUPABASE_PUBLISHABLE_KEY`: the browser-safe publishable key.

When configured, all live room records, participants, answers and state transitions use Supabase through `lib/live-store.js`. Blob is used only to load published vocabulary and class information when opening a new room. Existing Blob restrictions can still affect those initial loads and other class features. Without Supabase configuration, the old Blob storage path remains available for local demos and rollback; this path is unsuitable for regular classroom use under the free Blob allowance. Start new rooms after switching backends; old active rooms are not migrated.

Questions, initials, answers, and state stay AES-GCM encrypted using `VOCABULARY_PAGE_SECRET` (or the existing Blob token fallback). Keep the encryption secret stable. The database table enables RLS and grants no client read or write access. Only the server credential accesses records. Immutable primary keys preserve the first answer and prevent concurrent teacher actions from advancing twice. Rooms expire after four hours; creating a new room also deletes expired database records. Existing Blob records are left intact.

A database insert broadcasts only an empty refresh hint on a room-specific, unguessable topic. No names, answers, access tokens, or answer keys enter notifications. The authenticated Penina API still controls what each user can see. Notifications cause a debounced fetch; timers run locally with one scheduled fetch at each question/reveal deadline. A 15-second fallback refresh recovers missed notifications. If the realtime connection fails, the client falls back to periodic refreshes against the database, never live Blob reads. Hidden and finished screens disconnect and stop refreshing. Failed requests back off up to 30 seconds.

Browser role tokens remain signed, scoped to one room, and stored only in session storage. Refresh retains identity in that tab. Teachers can pause/resume; paused questions reject answers and preserve time. Correct answers are shown for two seconds, including on screens that miss the original reveal notification. Standings show only three places; each student also sees their own score.

The tests simulate a 26-student game with zero additional Blob operations after vocabulary is loaded, along with scoring, timing, immutable writes, and access control. This is not a production load test.

## Validation

`node --test tests/live-game.test.js tests/game-scores.test.js tests/student-games.test.js tests/class-games.test.js tests/study-cards.test.js tests/vocabulary-pages.test.js`

QR rendering uses vendored qrcode-generator 1.4.4 by Kazuhiko Arase, MIT-licensed, from https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js.

Realtime client: vendored @supabase/supabase-js 2.99.2 (MIT), https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.99.2/dist/umd/supabase.js.
