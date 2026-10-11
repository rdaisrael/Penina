# Penina Live — first version

Open Teacher tools on a class webpage using its existing editing code. Start Live Game lets the teacher select published sets, English or Hebrew answer choices, and up to 20 questions. Only current teacher-approved alternatives are eligible.

Students join the lobby by QR/link or six-digit code. Students enter 1–3 letter initials (English or Hebrew supported) and a required school email address. School email addresses are encrypted with the roster and included only in teacher email reports, not in browser snapshots or leaderboards. Latin letters are displayed in uppercase. The first submitted choice is final. Answers, answer counts by choice, and updated standings are revealed only when the teacher clicks Reveal answer. Each correct answer earns 100 points. Next question advances; End game shows final scores. Play again returns everyone to the same lobby with the same game code and student identities, and resets scores for a new round. Teachers choose manual pacing or 5, 7, or 10 seconds per question. Timed games display a countdown, reveal the answer for two seconds, then advance automatically. Correct student answers receive a brief fireworks animation after reveal (disabled for reduced motion). There are no teams or time bonuses.

## Local demo

Run `node scripts/preview-live.cjs` from the repository, then open http://localhost:4318. The demo editing code is `demo`. It uses sample Hebrew vocabulary and in-memory storage, with no production reads or writes. Use separate teacher/student tabs on this computer. The localhost QR is not an iPad-accessible public link; production QR links use the site's public origin. Restarting the demo clears its rooms.

## Server and Supabase setup

`/api/game-scores?game=live` dispatches to `lib/live-game.js`. Apply `supabase/live-game.sql` to the Supabase project, then set these Vercel production environment variables before deployment:

- `PENINA_SUPABASE_URL`: the HTTPS project URL.
- `PENINA_SUPABASE_SECRET_KEY`: a server-only secret API key; never put it in source or browser code.
- `PENINA_SUPABASE_PUBLISHABLE_KEY`: the browser-safe publishable key.

When configured, all live room records, participants, answers and state transitions use Supabase through `lib/live-store.js`. Blob is used only to load published vocabulary and class information when opening a new room. Existing Blob restrictions can still affect those initial loads and other class features. Without Supabase configuration, the old Blob storage path remains available for local demos and rollback; this path is unsuitable for regular classroom use under the free Blob allowance. Start new rooms after switching backends; old active rooms are not migrated.

Questions, initials, answers, and state stay AES-GCM encrypted using `VOCABULARY_PAGE_SECRET` (or the existing Blob token fallback). Keep the encryption secret stable. The database table enables RLS and grants no client read or write access. Only the server credential accesses records. Immutable primary keys preserve the first answer and prevent concurrent teacher actions from advancing twice. Replay does not extend the original four-hour room expiry. Rooms expire after four hours; creating a new room also deletes expired database records. Existing Blob records are left intact.

A database insert broadcasts only an empty refresh hint on a room-specific, unguessable topic. No names, answers, access tokens, or answer keys enter notifications. The authenticated Penina API still controls what each user can see. Notifications cause a debounced fetch; timers run locally with one scheduled fetch at each question/reveal deadline. A 15-second fallback refresh recovers missed notifications. If the realtime connection fails, the client falls back to periodic refreshes against the database, never live Blob reads. Hidden screens disconnect and stop refreshing. Finished screens keep listening for a replay and return to the lobby automatically when the teacher selects Play again. Failed requests back off up to 30 seconds.

Browser role tokens remain signed, scoped to one room, and stored only in session storage. Refresh retains identity in that tab. Teachers can pause/resume; paused questions reject answers and preserve time. Correct answers are shown for two seconds, including on screens that miss the original reveal notification. Standings show only three places; each student also sees their own score.

The tests simulate a 26-student game with zero additional Blob operations after vocabulary is loaded, along with scoring, timing, immutable writes, and access control. This is not a production load test.

## Validation

`node --test tests/live-game.test.js tests/game-scores.test.js tests/student-games.test.js tests/class-games.test.js tests/study-cards.test.js tests/vocabulary-pages.test.js`

QR rendering uses vendored qrcode-generator 1.4.4 by Kazuhiko Arase, MIT-licensed, from https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js.

Realtime client: vendored @supabase/supabase-js 2.99.2 (MIT), https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.99.2/dist/umd/supabase.js.

## Optional automatic score emails

Teacher tools includes **Send scores to teacher** under **Start Live Game**. It is
unchecked by default. Checking it requires a valid teacher email address. The
recipient is saved only in the encrypted room configuration and is never returned
to student clients. Final reports contain every student's initials and score;
unrevealed questions do not count. Reports are submitted automatically after a
manual ending or when polling advances a timed game through its final reveal.

One-time setup:

1. Create a Resend account and verify a domain you own by adding the DNS records
   shown at https://resend.com/domains. See
   https://resend.com/docs/dashboard/domains/introduction.
2. Create a sending API key in Resend. In the Penina project's Vercel environment
   settings, add `RESEND_API_KEY` with that key and `LIVE_SCORE_EMAIL_FROM` with a
   sender on the verified domain, for example `Penina <scores@your-domain.com>`.
   Do not put the API key in source control or browser code.
3. Redeploy Penina after adding those server environment variables. Run a test
   game with your own recipient address and verify receipt before relying on it.

With either variable missing, a game requesting email is rejected with a clear
setup message; games with the checkbox unchecked continue normally. No live email
has been sent during automated testing. Resend's idempotency key and an encrypted
sent marker prevent duplicate reports on retries. A failed submission leaves the
final scores available and gives the teacher a Retry score email button. Provider
acceptance is shown as submitted for delivery, not proof of inbox delivery.

## Replay settings

In the lobby, **Game settings** lets the teacher select 5, 10, 15, or 20 questions; manual pacing or 5, 7, or 10 seconds per question; and a 2, 5, 7, 10, 15, 20, or 30-second pause between questions. The pause shows the correct answer and standings. Manual pacing remains teacher-controlled. Uncheck wordlists to exclude them; originally selected lists remain available to include again. If fewer eligible terms remain than requested, all eligible terms are used.

Each round has separate answers, reveal cutoffs, scores, and score-email delivery. Old student submissions cannot count toward a new round. The teacher’s versioned restart is atomic, and student access tokens and the roster stay valid. Game settings and wordlist pools remain server-side; only the teacher receives wordlist names and settings. Replay is available for rooms created with this version; older rooms need to be recreated once.

## Classroom music

The authenticated teacher screen includes music controls above the game. Choose Playlist, add and reorder Kol Haderech and Schar Mitzvah, and press Play music. Playback stays on the teacher device across lobby/question/reveal updates. Teachers can pause, skip, adjust volume, choose play once or repeat, and select No Music to stop. Music stops at game completion and page exit; playlist settings stay available for Play again. A page refresh resets to No Music. Students do not load or play audio. The shared MP3 files are in `music/`.
