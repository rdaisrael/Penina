# Reader upload and original-story audit

## Confirmed defects and repairs

- The Reader offered a spreadsheet upload but accepted CSV only. Both pathways now accept Excel Workbook (.xlsx) files and link to Excel versions of the blank and sample templates. Original CSV assets and the dormant CSV parser remain for restoration.
- The old parser read verb categories from column A; the actual templates put roots in A and categories in B. Its category labels also differed from the template labels. Consequently every selected verb form was lost. The new parser reads B, normalizes labels and whitespace, and reports the imported counts. The sample imports 6 roots, 14 nouns, 5 adjectives and 10 selected verb forms.
- Empty or malformed uploads could be accepted, and an older asynchronous upload could overwrite a newer selection. Header/content checks, replacement-state clearing, and per-pathway upload versions now prevent this.
- A malformed AI word analysis rejected the entire original story immediately. The server now allows one repair against the fixed draft and exact Hebrew token sequence. Validation remains strict: rewritten source, missing words, and unverified mastery are still rejected.
- A live one-page original story took 52.6 seconds, close to the former 60-second AI timeout. Reader calls now have a 110-second limit with at most two calls total, including service retry or analysis repair. Dicta has a 25-second timeout; Vercel's observed function maximum is 300 seconds. Authentication, billing, and refusal errors do not retry.
- Non-JSON server failures previously surfaced as JSON parsing errors. Original and supplied reading requests now show a readable timeout/server error. Dicta rejection details are replaced with a service message.

## Verification and limits

- Existing full suite: 93 tests passed; two additional upload-state/HTTP-error checks added afterward.
- Tested the exact shipped ExcelJS browser bundle against both downloadable Excel workbooks, including a sample edited and saved again, blank/corrupt files, header checks, and selected tense extraction. Excel XML namespace serialization was normalized for compatibility with ExcelJS without changing cell data.
- Excel template previews were visually reviewed. Browser page inspection confirmed Excel download links and file inputs.
- Automated Chrome file selection was blocked by the extension's file-URL permission, so a real file-chooser test was not completed. Import and change-handler tests cover that code path independently.
- A live original-story request succeeded before this patch. The user's exact earlier error text and topic were unavailable; its exact cause was not reproduced. No claim is made that all possible AI or language errors have been eliminated.
- Structured output guarantees JSON shape, not semantic correctness; strict application checks remain necessary. Reference: https://developers.openai.com/api/docs/guides/structured-outputs
- Very long custom stories can still exceed output/time limits. Shva coloring remains the previously documented positional approximation.
