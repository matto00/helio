# HEL-1737 measurements

Environment: `helio1678-ci` (playwright v1.55.1-noble + fonts-dejavu, Liberation kept) and `helio1678-dv` (same, no
Liberation), each running `playwright run-server` (`--network host`), driven from the host against this lane's dev
server. Pre-swap face proven with CDP `CSS.getPlatformFontsForNode`: CI-like = Liberation Sans, dv = DejaVu Sans
(`base-ci/`, `head-ci/`, `head-dv/` JSON, field `facesBefore`). Base = 6432e69e0.

## 1.2 Real computed style (400, letter-spacing -0.01em), `chunit2-base-ci.out`

Default sentence width at 24px: web font 580.05, Liberation-matched fallback 589.05, DejaVu-matched 581.05.
The 40ch cap: Sans web 600 / fallback 560; Serif web 640 / fallback 560; Mono 560 / 560.
Content box of `.home-opening` at 605..613: 581..589 (viewport - 24); the ghost's cap (600) never binds there.
The web sentence fits at 605 (580.05 <= 581) and wraps at 604 (content 580). HEL-1678's 593/594-602 figures were
measured without the letter-spacing and are about 13px too wide; the driver's "~30px" claims re-measured below.

## 1.3 D3 feasibility: FAIL (both faces)

`adjsweep-arial-ci.out`, `adjsweep-dejavu-dv.out`: a sentence-only `size-adjust` does not move the width continuously.
Chromium rounds the size-adjusted font size to a whole pixel (hinted integer advances), so the 24px sentence is only
ever one of two widths:

| face | width at 24px | widths available |
|--|--|--|
| Liberation-matched (HEL-1678 104.94%) | 589.05 | 550.05 (size-adjust <= 102.0%) or 589.05 (>= 102.1%) |
| DejaVu-matched (HEL-1678 91.42%) | 581.05 | 555.05 (<= ~89.5%) or 581.05 (>= ~89.75%) or 608.05 |

The needed width is exactly 580.05 (fits at content 581, wraps at 580). Neither face has a size-adjust giving it, so
D3's PASS (i) cannot be met for either face, within 4% or otherwise. The residual is real and measured (head CSS,
`vsweep-head-ci.out`, `vsweep-head-dv.out`, ghost height versus the web-font ghost, fonts + summary held):
CI-like Liberation face: 605-613 differ (30px: one line vs two); DejaVu-only face: 605 only (581.05 vs content 581).
Nothing else in 320-1300 differs for the settled-stack sweep (`blocked`). `blocked-basestack` is the unmatched
system-ui stack, kept only for comparison.

## Desktop, data before the web font (new cases), runs card top spread across the font swap, px

| width | base-ci light | base-ci dark | head-ci light | head-ci dark | head-dv light | head-dv dark | head-host light/dark |
|--|--|--|--|--|--|--|--|
| 1024 | 30 | 30 | 0 | 0 | 0 | 0 | 0 / 0 |
| 1280 | 30 | 30 | 0 | 0 | 0 | 0 | 0 / 0 |
| 1440 | 30 | 30 | 0 | 0 | 0 | 0 | 0 / 0 |

Base: the sentence is two lines in the fallback, one line after the web font (`linesBefore 2 -> linesAfter 1`).
Head: one line throughout. Source: `base-ci/`, `head-ci/`, `head-dv/data-before-font-*.json`, `base-red.txt`.
The driver's "~30px desktop reflow" is reproduced exactly (30).

## Settled web-font rendering unchanged (4.1)

`tools/shots.mjs`, base vs head CSS, same server, web fonts loaded, 375/602/604/610/1024/1280 Sans and 1280 Serif/Mono,
light and dark (CI-like browser). Sentence rectangle identical at every size (Mono width 559.984 vs 560: the em value
is 0.016px under the 40ch). Pixel diff of the page down to and including the sentence: zero except a 14x8px box in the
eyebrow clock text (a minute tick between two runs), at y 74-82, above the sentence (y 97). Screens: `screens/`.
Cap in the settled long-sentence test (`head-ci/long-sentence-1280-*.json`): Sans 600/600, Serif 640.001/640, Mono
559.999/560; line counts 2/2/3, identical to base.

## Suites at head

`hel1665-home-phone-stability.spec.ts` + `hel1678-home-large-font.spec.ts`: 70 passed in the CI-like browser; 70 passed
on the host; the new data-before-font, 1440 and measure cases 16 passed in the dv browser. Light and dark throughout.

## Owner ruling ghost-nowrap-band (D3'), evidence at head

Rule: Sans only, `@media (min-width: 37.8125em)`, `.home-opening__ghost { white-space: nowrap; overflow: hidden }`; no upper
bound, because the web font's default sentence is one line at every Sans width from 605px up (the sweep confirms).
- Red on base (the ghost rule was unchanged from base in the band): 605, 606, 608, 610, 612, 613 x light/dark x both
  orders, CI-like env: 24 failed, fontSwapSpread 30 each (`base-band-red-ci.txt`).
- Head: the same cases plus 620 and 1440: 32 passed in the CI-like env and 32 in the dv env, fontSwapSpread 0 in all
  (`head-band-ci.txt`, `head-band-dv.txt`).
- Owner condition 1, 320-1300px every-width placeholder sweep (`tools/vsweep2.cjs`, ghost height, web font vs fonts blocked,
  CDP-proven faces: Liberation Sans in the CI-like env, DejaVu Sans in dv; web = Schibsted Grotesk [custom]): light and
  dark, both envs: zero differing widths of 981 (`vsweep2-head-ci.out`, `vsweep2-head-dv.out`). Before the rule the
  same method differed at 605-613 (CI-like) and 605 (dv) (`vsweep-head-*.out`).
- Owner condition 2: hel1665 + hel1678 large-font specs, 94 passed in the CI-like browser and 94 on the host (includes
  the Serif/Mono placeholder cases and the large-font spec).
- Not covered by the ruling (residual, for the PR body): the REAL sentence with data arriving before the web font at
  605-613px can still wrap in the fallback. The per-face behaviour of the run timeline (Liberation 605-613: two moves
  where base moved once; DejaVu 606-613: none where base moved twice; DejaVu 605: two where base moved once) is the
  one in design.md "Owner ruling 3"; the single-30px-swap description that was here is superseded. The AC's cold-load
  swap (placeholder on screen) is closed; no data-before-font case at these widths is asserted.

## Cycle 2 (evaluation-1 CR1, CR2, CR4)

- Tokens moved to `theme.css` (`--home-sentence-measure`, `--home-ghost-white-space`, a separate block after the type-style
  blocks so those stay font-tokens-only per `appearanceTokens.css.test.ts`); HomePage.css has no `data-type-style`
  selector and the guard `expect(css).not.toMatch(/data-type-style/)` is restored.
- Condition-1 sweep re-run after the move: zero differing widths of 981, CI-like (Liberation Sans) and dv (DejaVu Sans),
  light and dark, faces CDP-proven (`vsweep2-cycle2-ci.out`, `vsweep2-cycle2-dv.out`).
- Suites: hel1665 + hel1678 94 passed in the CI-like browser and 94 on the host; band + 1440 + data-before-font + measure
  cases 44 passed in dv (`cycle2-final-*.txt`).
- Settled rendering vs base (6432e69e0 CSS, same server): sentence rectangle identical at 375/602/604/610/1024/1280 Sans and
  1280 Serif/Mono, light and dark; the only pixel difference is the 8x8 eyebrow clock box (y 74-82) above the sentence.
- The measure test waits for the web face (CDP) and for `document.fonts.status === "loaded"` before its single read.
  Correction: an earlier version of this section described a retry poll for a Serif `40ch` read of 600px and said base's
  `40ch` cap was sometimes 600px. That is withdrawn. The executor saw one such read in a few host runs (no raw output was
  kept), the evaluator could not reproduce it in 7,920 reads, and nothing measured says base's cap was ever other than
  640px. The poll is removed; the settle waits above stay.
- The 605-613px data-before-web-font behaviour of the real sentence is an accepted residual: owner rulings
  accept-residual-with-followup and accept-double-shift-and-document; the current per-face description is design.md
  "Owner ruling 3" (not a single 30px reflow). Tracked by follow-up HEL-1748. It is not asserted.
