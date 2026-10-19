## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD 7d9bd8bc162d8771a21f5a87313475cbb6b3f17d (the cycle-2 diff 5214e3b6b..HEAD plus the full branch against
base 6477341111). Evidence is in `/home/matt/Development/helio/.concertino/scratch/HEL-1665/eval2-*`:
- `eval2-fontswap-held.json` and `eval2-fontswap-natural.json` (cold-load font-swap per variant)
- `eval2-fontswap-em25-*.json` (the candidate fix)
- `eval2-probe.json` and `eval2-loading-*` / `eval2-settled-*` screenshots (warm-font loading vs settled).

### Cycle-1 change requests

1. **431–604px shift: fixed.** The placeholder is now the hidden default sentence. With fonts warm, loading equals
   settled to the pixel at 375x667, 375x812, 430x932, 480, 540, 604, 605, 1024 and 1280, light and dark
   (`eval2-probe.json`). The e2e adds 480 and 540 to the shift tests and 480/604/605 to the line-count tests.
2. **Flake: fixed.** The series now starts at a recorded index, after `fonts.ready` and ten identical frames.
   Shift tests `--repeat-each=3`: 75/75 passed (cycle 1 failed 2 of 64).
3. **Font swap in the spec: stated, but the number and the cause are wrong.** See the font-swap judgement below.

### Font-swap judgement: the 33px is NOT acceptable as a stated bound

The ruling asked for: is the cold-load 33px at 1280 an acceptable bound, or a desktop regression to fix within Home?
It must be fixed, and it can be fixed within Home in one declaration. Measured on cold contexts (empty HTTP cache,
real Google Fonts, dev account). "held" means the summary is held until fonts are ready, which isolates the swap.
"natural" means no holds.

| width | HEAD held | base-sim held | HEAD natural | base-sim natural | `max-width: 25em` held / natural |
| ----- | --------- | ------------- | ------------ | ---------------- | -------------------------------- |
| 375   | 4         | 22            | 4            | 22               | 4 / 4                            |
| 540   | 4         | 32            | 4            | 32               | 4 / 4                            |
| 640   | **34**    | 4             | **34**       | 34               | 4 / 4                            |
| 700   | **34**    | 4             | **34**       | 34               | 4 / 4                            |
| 1024  | **34**    | 4             | **34**       | 34               | 4 / 4                            |
| 1280  | **33**    | 3             | **33**       | 33               | 3 / 3                            |

How the variants were measured:
- **base-sim:** HEAD with base's 28px bar restored and the ghost hidden by injected CSS, i.e. base's placeholder
  geometry.
- **25em:** `.home-opening__sentence { max-width: 25em }` injected over HEAD.
- **Runs card top:** the spread (px) of the runs card's top from first paint to settle.

Findings:
- **Root cause is Home's own CSS.** `.home-opening__sentence { max-width: 40ch }` (`HomePage.css:28`). The `ch` unit
  follows the font being rendered. At 1280, 40ch is 600px in Schibsted Grotesk (the text is 580px, one line) but
  549px in the system fallback, so the fallback wraps the sentence to two lines.
  - Before the change this only hit desktop when the summary arrived before the fonts.
  - The ghost renders at first paint, so now it hits every cold load at every width ≥605px, whatever the order.
  - In the held (fonts-first) order HEAD is 33–34px against base's 3–4px. That is a desktop and tablet regression,
    larger than the ~31px phone shift the ticket fixes.
- **The stated bound is wrong in two ways:**
  - It is not 1280-only: it is 34px at 640, 700 and 1024 too, every width ≥605.
  - It is not "outside Home": the wrap comes from Home's `ch` max-width, not from global font metrics.
- **The fix is one declaration in Home.** Schibsted's `ch` is exactly 0.625em, so `max-width: 25em` is the same 600px
  once the web font has loaded. Settled geometry stays identical: runs card top 393 at 1280, matching the C1 pin. The
  fallback stops wrapping, so the cold-load swap drops to 3–4px at every width in both orders. It also removes the
  pre-existing natural-order 33px on desktop.

### Phase 1: Spec Review — FAIL

- AC1: met with fonts warm at every width tested, including the 431–604 band. Cold-load behaviour is the defect
  above: the spec's new sentence (`specs/home-page/spec.md:24-26`) states a wrong number, a wrong scope and a wrong
  cause.
- AC2: documented-and-parked per C2. The hand-off was updated. Unchanged and correct.
- AC3: the executor says 480/540 were red on 5214e3b6b. My cycle-1 probe measured that same 30px at 480 and 600 on
  that commit, so I accept the claim.
- C1: the 1280 pinned-boxes test passes, and my probe confirms runs card top 393, first row 447, shelf head 159.
- C2: honored.
- design.md has the cycle-2 note. Its Decision 5 addendum claims the swap "lives outside Home", which my measurements
  contradict (see above).

### Phase 2: Code Review — FAIL (on the defect above; gates green)

Gates, re-run by me:
- lint, format:check, typecheck, check:e2e-types: pass.
- jest (2 workers): root 524/524, frontend 9057/9057.
- frontend build: pass.
- e2e `hel1665` + `hel1642` + `hel1583-home-375` + `hel1578-home-page`: 55/55.
- shift tests `--repeat-each=3`: 75/75.

Code checks:
- **Ghost sentence** (`HomeOpeningLine.tsx:35-38`): `aria-hidden="true"` and `visibility: hidden` inside the existing
  `role="status"` "Loading summary". Not exposed to assistive tech and not focusable. `DEFAULT_SENTENCE` is derived
  from `buildSummarySentence` (DRY, so it cannot drift from the real copy). OK.
- **Bar overlay:** `position: absolute`, tokens only. The per-width calc rules were removed, and the CSS guard test
  was updated to match. OK.
- **Unit test:** the `waitFor` added to `HomePage.test.tsx:174` is needed, because the ghost now carries the same
  text. OK.

### Phase 3: UI Review — FAIL

- Warm-font loading and settled states are coherent at 375x667, 375x812, 430x932, 480, 540, 604, 605, 1024 and 1280,
  light and dark. There are no console errors and no horizontal scroll.
- **Cold-load desktop/tablet swap (≥605px):** 33–34px, measured above. This is a regression against base in the
  fonts-first order.
- **Judgment, for the skeptic:** at 431–604 a single 20px bar sits centred in a two-line (60px) block.
- **Test data:** every e2e user was deleted by recorded id; `users like 'hel1665h-%'` = 0. I created no data.

### Overall: FAIL

### Change Requests

1. **Use a font-independent max-width.** In `frontend/src/features/home/ui/HomePage.css:28`, change
   `.home-opening__sentence { max-width: 40ch; }` to `max-width: 25em;`. The comment should say: the same 600px as
   40ch in Schibsted Grotesk, but it does not shrink in the fallback font, so neither the hidden default sentence nor
   a fallback-font sentence wraps before the web font arrives (HEL-1665). Then:
   - Verify with `eval2`'s method (cold context, held and natural) that the swap is ≤4px at 640, 1024 and 1280.
   - Verify that the C1 pinned boxes are unchanged.
   - Check the "Serif headings" type style (Fraunces as `--font-heading`). If 25em changes that style's settled wrap
     for the default sentence at 1280 or 605–1100, record the numbers. If it changes, choose a value that keeps the
     Schibsted geometry and report the Fraunces delta, rather than silently changing it.
2. **Make the e2e assert the swap bound.** Add an assertion that `fontSwapSpread` ≤ 4.5px in the shift tests (all
   widths), or in a dedicated cold-load test at 640/1024/1280. Show it red on 7d9bd8bc1 (it measures 33px there).
   Today the spec reports the swap but never asserts it, so this regression went through green.
3. **Correct the spec and design text.**
   - `specs/home-page/spec.md:24-26`: state the swap as ≤4px at every width, a font-metric residual. Remove "33px at
     1280" and remove "which is not Home's" for the wrap part.
   - design.md's Decision 5 addendum: name the `ch`-unit cause and the fix.
   - `item2-owner-handoff.md`'s residual list: update it to match.

### Non-blocking Suggestions

- 431–604px loading state: a two-bar placeholder (one bar per ghost line) would read better than a single bar centred
  in 60px. This is a judgment call for the skeptic, not required.
