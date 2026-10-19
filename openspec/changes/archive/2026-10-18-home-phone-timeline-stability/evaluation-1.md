## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 5214e3b6bf0509976ec1d5cd2af481c69f46f124 against base 6477341111d4b4ec6d0368e5a1f46e473325f226
(resolved live with resolve-review-base.sh). Evidence from this review is in
`/home/matt/Development/helio/.concertino/scratch/HEL-1665/eval1-*` (the driver's durable scratch dir).

### Phase 1: Spec Review — FAIL

- AC1 (0px move on load): met at the four named viewports, both themes, both orders, once web fonts have loaded.
  My own probe (dev account, requests held, fonts loaded) shows loading == settled for runsTop, contentTop and
  shelfTop at 375x667, 375x812, 430x932 and 1280x900, light and dark (`eval1-probe.json`).
  **Gap:** design.md Decision 4 says to measure the default sentence's line count and match any band that differs
  "(e.g. 431–768)". The executor measured only 375/430/768/820/1280 and so missed the band. Measured at 1px steps
  (`eval1-sentence-band.txt`): the default sentence is **2 lines from 431 to 604px** and 1 line from 605px up. The
  placeholder is 1 line above 430px, so in 431–604px the timeline still moves **30px** on every load (480x900:
  runsTop 506.75 → 536.75; 600x900: 559.25 → 589.25; shelf moves too). That is the size of the shift the ticket
  reports. This band is still the phone shell with the bottom nav (screenshots `eval1-loading-480x900-*.png`). The
  spec delta only says "phone widths and desktop width", so it hides the gap instead of stating it. This is a
  content-independent mover, which ticket "Scope for this run" says is removed. It is not one of the stated
  sentence-length residuals.
- **Web-font swap.** The spec delta says the timeline does not move "from Home's first paint". On every cold load the
  runs card moves 3px (1280) or 4px (phones) when the fonts swap (`fontSwapSpread`; reproduced in all 64 of my runs).
  The e2e leaves this out of the asserted series. `item2-owner-handoff.md` lists it, but the spec and design do not
  state it as a bound. Decision 5 says to escalate a mover that lives outside Home, not to exclude it without saying
  so in the spec.
- AC2: parked per C2. `item2-owner-handoff.md` is present and correct in shape: options 1–4, before/after
  measurements, and residuals. I re-ran the 375x667 info test: runs heading bottom 546.8, first row top 563.8,
  first row bottom 643.8, nav top 599, same in light and dark. These match the hand-off. Judged documented-and-parked.
- AC3 (fails first): red evidence for unmodified code and for mutations M1–M5 is present in scratch
  (`red-final/`, `mutations/M1..M5`). Each mutation turns at least one test red.
- Tasks: 3.7 is open, which is correct (it is a PR/merge-time step). The other tasks match the diff.
- Scope: only Home files, the new e2e and support file, DESIGN.md and planning artifacts. No pipeline or token
  files. OK.
- C1: the 1280 desktop pinned-boxes test passes in both themes, and my independent probe gives the same numbers
  (runsTop 393, first row 447, shelf head 159). The pinned values come from the base run in `base/desktop-1280-*.json`.
  Honored.
- C2: honored, AC2 parked as above.

### Phase 2: Code Review — FAIL

Gates, re-run by me in WORKTREE_PATH:
- `npm run lint`: pass. `npm run format:check`: pass. `npm run typecheck`: pass. `npm run check:e2e-types`: pass.
- `npm test` (2 workers, nice 19): 61/61 suites, 524 tests (root) and 724/724 suites, 9057 tests (frontend). Pass.
- `npm --prefix frontend run build`: pass.
- e2e `hel1665` + `hel1642` + `hel1583-home-375` + `hel1578-home-page` (2 workers): **43 passed, 1 failed**
  (`Home load (1280x900 dark summary-first)`: runsTopSpread 3, contentTopSpread 3.5).
- I re-ran the 16 shift tests `--repeat-each=3`: **47 passed, 1 failed** (`375x667 dark summary-first`: runs 4,
  content 6).

**Flaky shift test, root cause found.** `e2e/hel1665-home-phone-stability.spec.ts:88` keeps frames with
`s.fonts === "loaded"`. `document.fonts.status` can read `"loaded"` on the very first frames, before the stylesheet
has started any font load. In both failing runs `fontsAtFirstFrame` was `"loaded"`, followed by 4–5 `"loading"`
frames. So pre-swap frames get into the asserted series and the font swap (3–4px) fails the test. This happened in 2
of 64 runs. With 16 such tests per suite run, roughly 1 suite run in 3 goes red in CI.

Code observations (pass unless noted):
- Hidden link slot (`DashboardShelf.tsx:41-46`): `aria-hidden="true"`, `visibility: hidden`, a `<span>` with
  tabIndex -1. Measured in the running app: not focusable. The aria snapshot of the loading shelf shows only the
  heading and "Loading dashboards". Correct.
- Legend while loading (`PipelineRunsCard.tsx:28`): a static `list "Legend"` with no live region, so it is not
  announced as an update. The runs card's `status "Loading pipeline runs"` is still exposed. Acceptable. The
  `status !== "failed"` guard keeps the legend off the error state.
- DESIGN.md §3 expander (`HomePage.css:787-806`): `position: relative` plus a 44x44 centred `::after`, guarded by
  `expectTapExpander(..., "square")`. The e2e bisection (`bisectHitExtent`, which asserts ≥43.75 internally) passed
  for both `All N` and `+N more` at 375. `.home-upnext__row` keeps grow-the-box. Compliant.
- Tokens only. No raw px except the §3-mandated 44px. No new breakpoint values. No `any`.
- Skeleton foot reuses the loaded foot's classes with hidden text. DRY and correct by construction.

### Phase 3: UI Review — FAIL

- Happy path, both themes, 375x667 / 375x812 / 430x932 / 1280x900: settled layout is coherent with the running
  app. Loading state shows the legend, skeleton cards and the placeholder (`eval1-loading-*`, `eval1-settled-*`).
  No console errors in any probed flow. No horizontal scroll (scrollWidth == viewport at every width).
- Desktop 1280 unchanged against the base pins (C1).
- **Breakpoint check: a 30px load shift remains at 431–604px** (see Phase 1). Measured, not judged.
- Loading skeleton bars in dark are low-contrast. That is the pre-existing `Skeleton` look and a judgment call for
  the skeptic, not a finding here.
- Test users: the e2e global teardown deleted every recorded user. I checked `users where email like 'hel1665h-%'`
  and the count is 0. I created no data (all checks used the shared dev account, read-only).

### Overall: FAIL

### Change Requests

1. **Fix the 431–604px opening-line shift.** Recommended: build the opening placeholder the same way you built the
   link slot and skeleton foot. In `HomeOpeningLine.tsx`'s loading branch, render the default sentence
   ("All quiet: nothing has changed, failed or been missed.") as a `.home-opening__sentence` element with
   `visibility: hidden` and `aria-hidden="true"`, inside the existing `role="status"` / "Loading summary" wrapper.
   Lay the skeleton bar over it (`position: absolute`, like `.home-card__name--skeleton`). Its height then equals the
   default sentence at every width by construction. You can delete both
   `.home-opening .home-opening__skeleton-line` height rules (`HomePage.css:39-42` and `:766-768`), and with them
   the `--text-xl`/`--text-2xl` line-count guesses.
   Then add a width to the shift test that sits in the band (e.g. 540x900, light and dark, both orders, with
   `sentenceLines: 2`). Show it red on the current commit, and update the M3/M4 mutations to match.
   If you keep the per-width CSS approach instead, you cannot match the band with DESIGN.md §4 breakpoints alone
   (the switch is at 605px). In that case, state the band and its 30px move as a bound in `specs/home-page/spec.md`
   and in the hand-off residuals, and escalate it.
2. **De-flake the shift test** (`e2e/hel1665-home-phone-stability.spec.ts:85-89` and `loadHome`). Do not filter by
   `fonts === "loaded"`. In `loadHome`, after `document.fonts.ready` and the 300ms wait, and before releasing the
   first request, record the start index (e.g.
   `const start = await page.evaluate(() => window.__h1665.samples.length)`) and return it. Assert spreads over
   `samples.slice(start)`. Compute `fontSwapSpread` over the frames before `start`. Apply the same change to the
   bound test (`:155`).
   Prove it with `--repeat-each=5` over the 16 shift tests, run green, and save the output to evidence.
3. **State the web-font swap in the spec.** In `specs/home-page/spec.md`, change "From Home's first paint ... SHALL
   [not] move (0px, measured)" so the rule applies once web fonts have loaded. Add the measured cold-load font-swap
   move (3px at desktop, 4px on phones) as an explicit bound, the same way the sentence-line and zero-pipeline
   bounds are stated. Add a line in design.md (Decision 5) recording that the swap lives outside Home and was handed
   to the owner rather than fixed.

### Non-blocking Suggestions

- After CR1, the CSS guard test's placeholder-height assertions (`HomePage.css.test.ts:28-35`) should pin the
  hidden-sentence structure instead.
- `item2-owner-handoff.md`'s "Web-font swap" residual could cite the cold-load measurement method (first frames
  before `document.fonts.ready`).
