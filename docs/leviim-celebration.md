# First-correct Leviim celebration

The first correct responder sees two cartoon Leviim at reveal, with musical notes moving from their shofars and three quiet synthesized horn blasts. The winner comes from the existing server-awarded first-correct bonus; scoring and reveal timing are unchanged. Other correct answers retain their regular fireworks.

The effect lasts 2.1 seconds and cancels immediately on the next question, pause, page exit or backgrounding. Its fixed overlay never receives taps or changes the game layout. Audio is primed by an ordinary student tap, uses a low gain, and never waits for media or retries delayed sound. If playback is unavailable, the game continues normally. Reduced motion shows still figures without traveling notes. Session storage prevents duplicate celebrations on refresh.

## Artwork and sound

Workspace asset: `PeninaPlus-vocab-builder/flash-cards/live/leviim.webp` (two equal-width sprite cells, transparent, 126 KB). Created with the built-in image-generation tool and encoded as WebP for the game. `shofar.js` synthesizes the sound locally; it is not a recording. `shofar.css` animates the two characters and notes.

Fine linen clothing is informed by [II Chronicles 5:12](https://www.sefaria.org/II_Chronicles.5.12); this is a stylized classroom illustration, not a reconstruction of a Temple ceremony. The three-blast rhythm follows the description of [shevarim](https://www.chabad.org/library/article_cdo/aid/7028824/jewish/What-Do-the-Shofar-Blasts-Mean.htm).

Final image-edit prompt (the initial two-character sprite sheet was the reference):

> Edit the supplied transparent two-character sprite sheet for a middle-school classroom game. Make BOTH Levites MUCH MORE CARTOONISH: charming 2D animated cartoon characters, oversized expressive heads, rounded simplified features, clean bold outlines, simplified flowing ivory linen robes, broad readable shapes and cheerful character appeal. Warm, respectful, fun; no photoreal skin, painterly realism, or detailed fabric texture. Preserve the exact layout: 1536x1024 wide sheet with two equal-width cells, left man facing right, right man facing left, both blowing natural curved ram's-horn shofars held to their mouths with both hands. Distinct dark-bearded and gray-bearded faces; modest white linen headwraps, simple sashes, full ankle-length white linen tunics, barefoot. Entire figures and horns must remain within their own half with transparent padding, same baseline, no crossing center. ACTUAL TRANSPARENT ALPHA background. No scenery, shadows on a ground plane, text, high-priest vestments, jewelry, or modern clothes. Keep the horn openings clear near the upper inner corner of each cell; flowing musical notes will be ANIMATED IN CODE from these horn openings, so do not bake notes into this sprite sheet. The final in-game effect will include animated notes. This edit changes the illustration style while preserving the two separate sprites and their orientation.

## Verification

`node --test tests/*.test.js` covers eligibility, once-only playback, three quiet blasts, immediate cancellation, missing media and reduced motion. `tests/live-layout.browser.cjs` checks local touch interactions and layout at phone, iPad and desktop sizes; all requests are local fixtures. The browser audio preview uses the same synthesis and illustration as the game. Physical iPad speaker volume and silent-mode settings have not been tested on hardware.
