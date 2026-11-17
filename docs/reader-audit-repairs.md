# Penina Hebrew Reader consistency repairs

Scope: the nine findings in `audits/Penina-Reader-audit-2026-09-13.md` (audit stored in the parent workspace). These changes build on the deployed native Dicta qamatz-qatan/dagesh fixes. They are not changes to the legacy reader's vocabulary workflow.

## Result consistency

The reader now requests a strict JSON response from OpenAI with the story and one analysis entry per Hebrew word, including repetitions and the title. Each entry has its surface word, mastery decision, contextual English gloss, matching vocabulary entry, and selected verb form. The server validates word count/order and rejects missing or malformed entries. The structured result replaces the old footnote-delimiter protocol for the Penina Hebrew Reader; legacy `/api/generate` clients retain their plain-text contract.

The same saved per-word decision controls both emphasis and footnotes. Pointed vocabulary is normalized on both sides. Parts-of-speech and uploaded lists retain roots and exact selected binyan/tense combinations. A claimed verb-root match cannot be mastered if its form is not selected; an empty form selection permits no derived verbs. Fabricated vocabulary matches cannot become mastered. Uncertain linguistic cases are instructed to remain unmastered.

Each generated result keeps a normalized vocabulary snapshot. Editing a draft or switching workflows does not reinterpret a displayed story. Generate again to apply vocabulary edits. Formatting controls remain available during loading and operate on the last successful result.

Footnotes are numbered locally. “First occurrence” groups the same unpointed word form after removing contextually identified grammatical prefixes ל, ב, ש, ה. The per-word analysis supplies the prefix, and validation checks its letters and correspondence to the surface word. Letters belonging to the lexical word, root, or verb pattern are retained; uncertain prefixes remain unstripped. Different contextual glosses are collected in the same note. Other inflections can have separate notes. Older saved analyses without prefix metadata retain exact-word grouping. Hiding notes never changes mastery decisions.

## Source text, display, and async state

Supplied text is checked after Unicode decomposition and removal of Hebrew combining marks; punctuation, consonants, word boundaries and paragraph breaks must be unchanged (outer whitespace and CRLF are normalized). Dicta receives the original supplied text, never AI translations or JSON. Its response is aligned against the original word sequence before display. Punctuation and paragraph breaks come from the source. Standard pointed spelling can adjust vowel letters (for example סיפורים → סִפּוּרִים), but only when Dicta’s native token mapping proves the exact source/selected-output pair and all other letters match. These adjustments are disclosed in the result status, and the exact original remains in sourceText. Generated stories receive the same checks. Malformed results leave the last successful story intact.

Dicta's native vowel marks and dagesh remain preserved in story and worksheet output. Font choice no longer enlarges mastered words; bold follows its checkbox. Existing optional divine-name display substitutions remain explicit. Shva colors are now labeled estimates: their positional heuristic is not an authoritative linguistic analysis.

Original-story requests always select modern nikkud. The supplied-text Biblical choice is explicitly labeled as Dicta poetry mode.

All external story, footnote, worksheet-title/body, and error text is escaped or assigned through textContent before application-owned markup is added.

Story and worksheet requests have version IDs. New story requests cancel/invalidate old worksheets; old responses cannot overwrite new results or enable printing for the wrong story. The worksheet button is disabled while a story request is pending. Worksheets are checked for consecutive question numbers, exact requested count, and two to four answer lines per question. Malformed worksheets do not replace the last successful worksheet.

## Verification and limits

Regression tests cover normalization, inflections using a saved analysis, allowed/disallowed verb forms, ambiguous/unknown matches, repeated-word notes, source preservation, malformed structure, HTML escaping, frozen vocabulary, and stale asynchronous responses. Browser fixture checks reproduce the audit's supplied-text workflow, pointed vocabulary, form switching, repeated footnotes, dyslexia font, and worksheet direction/answer lines.

The strict-schema model call has mocked request/response coverage. Live Vercel preview checks passed for the supplied-text audit example with pointed vocabulary, plural/prefix mastery, repeated footnotes, frozen vocabulary after switching forms, and a two-question English worksheet. The original-story check caught Dicta’s standard vowel-letter spelling conversion; the exception is now limited to native token evidence and regression-tested. A repeat live original-story test then passed with three paragraphs, consistent word mastery/notes, and a visible standard-spelling adjustment notice. All 71 automated tests pass. These checks do not establish general linguistic accuracy. A human-reviewed Hebrew corpus, longer-generation latency checks, and cross-browser print/PDF checks remain necessary before claiming general linguistic or print reliability.

Per-word structured output increases generation size: the reader analysis requests up to 32,000 output tokens with a 60-second per-attempt deadline. Incomplete output fails explicitly. Ordinary vocabulary-builder and worksheet requests retain existing limits.

Official structured-output reference: https://developers.openai.com/api/docs/guides/structured-outputs


## Footnote placement controls

Both content sources use the shared Footnote Display and Footnote Placement controls. Supplied text now defaults to spreadsheet vocabulary upload, with the manual modes retained but hidden. Per-page placement measures rendered words and their visible notes together within a Letter page (including the chosen margin width), preferring sentence/paragraph boundaries. Notes repeat on pages with visible references in each-occurrence mode; first-occurrence mode keeps one reference across the document. Typography and display changes rebuild the pagination. Markers stay attached to words, and line numbering continues across pages. End placement retains the continuous document and final note section.

Run `node tests/reader-layout.browser.cjs` with Playwright available (or set PLAYWRIGHT_MODULE and CHROME_EXECUTABLE). The browser fixture checks both vocabulary modes, footnote controls, retained words, note/reference correspondence, page overflow, typography, margins, line numbering, and matching screen/print page counts; it also saves screenshots and a print PDF in a temporary directory. An exceptionally large single word/title/gloss is allowed to flow across printed pages rather than being clipped.

## November 17: delivery of slow Reader responses

The authorized Vercel log inspection found Reader request `rx75n-1794940040693-eae11a676bcf`, starting November 17 at 13:27:20.693 America/New_York on deployment `dpl_Fa7K2ZwfF7Eq52UUFcUUZWRgqa5a`. It returned HTTP 200 after 177.7 seconds, below its 300-second function limit. The trace listed two OpenAI Responses calls lasting 90.16 and 86.36 seconds, followed by a 1.09-second Dicta call. Neither AI call reached Reader's 110-second limit. No console logs were retained for the request, so the trace does not distinguish an analysis correction from a transient-service retry. The screenshot at 13:29:45 showed the browser's non-JSON-response error despite the eventual successful origin response.

The origin's successful completion and the reported roughly two-minute failure are consistent with a proxy ending the browser's wait before the result arrived. Cloudflare documents a default [125-second Proxy Read Timeout](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/); the screenshot does not retain the actual HTTP status, so a specific 524 response remains unconfirmed. Merely raising the AI or function timeout would not address this delivery problem. The earlier Binyan incident included both rejected morphology and actual AI timeouts; neither is established as the failure of this Reader request.

Reader now opts into an event stream on the existing authenticated `/api/generate` route. It sends stage updates and a heartbeat every 15 seconds while generating, repairing/checking analysis, and adding vowels. The browser waits for the final checked result; progress never displays an unchecked story or footnotes. Disconnection cancels upstream work, and completion/failure clears heartbeat timers. Existing clients without `Accept: text/event-stream`, including Binyan Builder and legacy readers, retain JSON responses and HTTP status codes. Once streaming headers have been sent, failures are carried in the final event's status/error rather than changing the HTTP 200 already sent. Invalid requests and account checks can still return ordinary JSON before streaming begins.

The model, prompts, 110-second AI limits, two-call maximum, and all content validation are retained. Reader now records the generation/retry/analysis-repair stage, attempt, duration and controlled failure code, following Binyan's diagnostic pattern without recording source text, vocabulary, or provider bodies.

`tests/reader-stream.integration.cjs` runs real loopback HTTP servers and Chrome through an idle-timeout proxy with proportionally shortened timing. A silent request loses its result at the proxy even though the origin completes successfully; the same generation/repair flow with progress delivers its checked result. It also verifies analysis and Dicta failures, retained inputs/previous readings, and controls becoming available again. Provider outputs are simulated: this checks HTTP delivery, not real-model speed, linguistic quality, or production proxy behavior. Unit checks cover split UTF-8/records, truncated streams, cancellations, cleanup, errors and legacy compatibility. The local changes have not been deployed or tested on the live site.
