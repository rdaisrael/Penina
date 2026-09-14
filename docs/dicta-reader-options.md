# Dicta options for PeninaPlus Reader

## Behavior

PeninaPlus requests `keepqq: true` (distinct Unicode kamatz katan) and
`addmorph: true` (lexical/morphological information) for stories, supplied text,
and worksheets. `matchpartial: true` remains enabled. Special rabbinic dagesh
and biblical-style מה rules are explicitly false. Other callers of
`/api/generate` keep their existing defaults.

The API continues to return `text`. When morphology is requested, it also returns
`dictaTokens`, retaining original tokens, alternative readings, and analysis.
The current reader still uses `text`; morphology-based vocabulary classification
and a manual correction interface are not implemented by this change.

The PeninaPlus renderer uses Dicta's U+05C7 marks directly for kamatz-katan color.
It no longer converts vowels based on a hardcoded word list, strips dagesh, or
rewrites the pointing of Daniel. The existing divine-name display preferences
remain available. The simpler Penina Reader is not changed.

## Verification

Verified on Dicta's current public service:
`https://nakdan-u2-1a.loadbalancer.dicta.org.il/api`.

For `כל ילד לומד חכמה. הילדה חכמה מאוד.`:

- Options off: `כָּל יֶלֶד לוֹמֵד חָכְמָה. הַיַּלְדָּה חֲכָמָה מְאוֹד.`
- Options on: `כׇּל יֶלֶד לוֹמֵד חׇכְמָה. הַיַּלְדָּה חֲכָמָה מְאוֹד.`
- `addmorph: true` added `lex` and `morph` to the returned alternatives.

`keepmetagim: true` did not preserve the meteg in the supplied test word
`הָֽאִישׁ`; do not assume it guarantees preservation of user-entered meteg.
It is therefore not requested by default in PeninaPlus. If Dicta returns meteg,
the parser and renderer retain the mark.

The fixture in `tests/fixtures/dicta-nikkud-public.json` records the public-service
response. Automated tests cover request isolation, response parsing, preserved
marks, metadata, renderer color behavior, font tuck behavior, and API integration.
A local browser check used that recorded response and confirmed that only the
explicit kamatz-katan marks receive the kamatz-katan color.

## Authenticated production-endpoint verification

Verified with Penina's `DICTA_API_KEY` from its Vercel environment variables:
`https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud`.

The authenticated test passed with the final reader option set:

- `keepqq: true` returned explicit kamatz katan in `כׇּל` and `חׇכְמָה`.
- The ordinary kamatz in `חֲכָמָה` remained unchanged.
- `addmorph: true` returned lexical and morphological data.
- Existing partial vowel pointing was respected; the supplied meteg was not retained.
- The tested output matched the current public service for this passage. This is a
  compatibility check, not a general accuracy benchmark.

The key was passed from Vercel to a temporary loopback test form, then into the
existing test process's environment. It was not displayed, saved to a file, or
added to the repository. The Vercel variable was not modified. No endpoint
migration is needed for these features.

With `DICTA_API_KEY` securely present in the process environment, run:

```sh
node tests/dicta-live-check.js
```

To repeat the separate public-service check without that key:

```sh
DICTA_TEST_ENDPOINT=https://nakdan-u2-1a.loadbalancer.dicta.org.il/api node tests/dicta-live-check.js
```

No endpoint migration or deployment is included in this change.

## References

- [Dicta Pro settings](https://nakdanpro.dicta.org.il/documentation/)
- [Dicta Pro application](https://nakdanpro.dicta.org.il/), whose current request
  builder maps its kamatz-katan option to `keepqq` and requests `addmorph`.
