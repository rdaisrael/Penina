# Reader generation with OpenAI

Both readers use `/api/generate` for stories, footnotes, and worksheets. It now sends the existing prompt to OpenAI's Responses API, then sends generated text to Dicta for nikkud. Supplied text bypasses OpenAI. The vocabulary-builder `/api/translate` service also uses OpenAI for translations and context generation. Both services share `OPENAI_API_KEY`; the Google SDK is retained only for historical files in `api/Archive`; the active endpoints no longer call Gemini.

## Vercel configuration

Set `OPENAI_API_KEY` as a server-side environment variable in the Penina project, for the environments that will run this change, then redeploy. Never put the key in HTML, a `NEXT_PUBLIC_` variable, source control, or a chat message. An API project needs its own billing/quota; a ChatGPT subscription does not supply API credit.

Optional server variables:

- `OPENAI_VOCAB_MODEL`: vocabulary model, defaults to `gpt-5.6-terra`.
- `OPENAI_VOCAB_FALLBACK_MODEL`: optional vocabulary fallback, disabled by default.
- `OPENAI_VOCAB_TIMEOUT_MS`: per-attempt vocabulary timeout, defaults to 20000.
- `OPENAI_BATCH_CONCURRENCY`: vocabulary batch concurrency, defaults to 3 (maximum 8).

- `OPENAI_READER_MODEL`: defaults to `gpt-5.6-terra`, preserving the former Flash model's lower-cost primary role.
- `OPENAI_READER_FALLBACK_MODEL`: defaults to `gpt-6-astra`, preserving the stronger fallback role. An empty value disables fallback.

Use models supporting Responses, low reasoning, and `max_output_tokens`. The adapter makes at most two primary attempts and one fallback attempt, only for transient failures. Authentication, model configuration, insufficient quota, refusal, and incomplete output fail without fallback. Each attempt has a 35-second abort deadline, with 1/2-second retry delays. The Vercel function's configured duration must accommodate up to 108 seconds for generation plus Dicta processing. Shorter platform deadlines can terminate a request first.

Requests use `store: false`, low reasoning, and a 10,000-token output limit (including reasoning). `store: false` does not imply zero provider retention. REST response parsing collects assistant `output_text` content rather than assuming the first output item is text. Incomplete output is rejected before Dicta.

## Verification

Run `node --test tests/*.test.js`. Mocked tests cover request shape, reasoning/text extraction, transient fallback, authentication/quota/configuration errors, aborts, refusals, incomplete responses, and the OpenAI-to-Dicta handoff. Dicta's separately verified qamatz-qatan and morphology options remain intact.

The dedicated `penina-vercel` key is configured as a Vercel Secret in Production and Preview. Authenticated Hebrew-generation requests passed for both `gpt-5.6-terra` and `gpt-6-astra`. The key is restricted to Responses access and has no expiration. No key value is stored in this repository. A broader Hebrew quality comparison is still required. Test a short story with vocabulary footnotes, a worksheet, and longer reading passages. Provider migration alone does not fix the reader's existing mastery/footnote inconsistencies or establish that Hebrew generation is more accurate.

## Official references checked for this migration

- Responses text generation: https://developers.openai.com/api/docs/guides/text
- Primary model: https://developers.openai.com/api/docs/models/gpt-5.6-terra
- Latest-model resolver returned `gpt-6-astra`.
- Migration guide: https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart
- Prompting guide: https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#prompting-best-practices
