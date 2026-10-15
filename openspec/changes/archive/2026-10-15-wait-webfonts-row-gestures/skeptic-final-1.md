## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: `b6cc9874dd9baa08de2e77fd9d8837d8148020e8`. Diff base resolved live with `resolve-review-base.sh` (main/origin): `60086f02bb5b1ee48f2246bc09e3e66349199585`.
The diff is test-only: `e2e/support/webFonts.ts` (new), `e2e/support/rowDeleteGesture.ts` (+import, and `settledRowTop` calls `waitForWebFonts(button)` first), `e2e/hel1605-row-delete-confirm.spec.ts` (`REVEAL_DELAY_MS` + `page.clock.runFor(600)` before B is placed in the I8/I14 loop). The rest is openspec artifacts and evidence. No product code changed, so there is no UI review (step 4 N/A).

### What I verified (with evidence)

**1. The helper prevents the font-swap reflow at the gesture point. I reproduced the red myself and did not rely on the executor's logs.**
- Scratch spec, kept out of the tree in the gitignored `build/` directory: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1606/evidence/build/skeptic-hel1606/skeptic-repro.spec.ts.txt`.
  - It runs under the fake clock (`installFreshClock`) at 820x900 with 22 rows, and targets `deletes.nth(15)`.
  - It calls `placeBottomNearViewportEdge` from either the **base** (`git show 60086f02b:e2e/support/rowDeleteGesture.ts`) or the **head** helper.
  - It records the row top at the gesture point, waits, re-reads the top, then double-clicks.
- **Fonts delayed 1200ms** (`fonts.gstatic.com`), `--repeat-each=3`:
  - Base: **6/6 failed**, on both routes. The row moved after the gesture point: `/sources atGesture=783.5 later=756.5` and `/pipelines atGesture=789.5 later=755.5`. Fonts were `loading` at the gesture point.
  - Head: **6/6 passed**, with `atGesture == later` (785.5 and 789.5) and fonts `loaded`.
- **Stylesheet delayed 4000ms** (`fonts.googleapis.com`; this is the branch where `document.fonts.status` is vacuously `loaded`):
  - Base: 1/4 failed (`/pipelines 789.5 -> 755.5`).
  - Head: 4/4 passed.
- Log: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1606/evidence/build/skeptic-hel1606/skeptic-font-repro.log`
- The same predicate holds on both routes and through both delay paths, so the wait is non-vacuous on /sources and /pipelines. The helper's `link.media === "all"` term is what defeats the vacuous `status === "loaded"` that the ticket's suggested fix would have accepted.

**2. Every row double-click goes through the wait.**
- `grep -rln "dblclick\|clickCount: 2" e2e` returns only the two target specs.
- Every gesture in them computes its point after `settledRowTop`, either directly or via `placeBottomNearViewportEdge`:
  - hel1574 `:381/:387` (bare `page.goto` 375/1280 test) and `:530/:536`
  - hel1605 `:102`, `:179/:190`, `:233/:244`, `:289/:295`
- The `mouse.down({clickCount:2})` at hel1605 `:315` runs in a document whose fonts the same test already waited for at `:289`.
- The wait reads fonts, never labels. The `freshRowLabel` assertions still run before each gesture.

**3. AC1 (`--repeat-each=30`, 2 workers), my own fresh run.**
- Command: `DEV_PORT=7038 nice -n 19 playwright test e2e/hel1605-row-delete-confirm.spec.ts e2e/hel1574-shell-rail.spec.ts -g "I8|I14|I17|I19|double-click" --repeat-each=30 --workers=2`
- Result: **`270 passed (14.5m)`**, exit 0, no flaky tests.
- Log: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1606/evidence/build/skeptic-hel1606/skeptic-ac-repeat30.log`

**4. The `clock.runFor` edit does not weaken HEL-1605's switch test. I derived this from the code, not from the evaluator's account.**
- In `rowDeleteFocus.ts`, `arm()` sets a 500ms `setTimeout` reveal (`scrollIntoView({block:"nearest"})`). A **wheel/touchstart** cancels it, but a programmatic scroll does not.
- On base, `agePage` runs `clock.fastForward(8000)`, which fires due timers. That means A's reveal **always** fired before B's first press: either in real time or inside `agePage`, after B's placement and after the `scrollTop >= aHeight` / `groupBottom < 0` checks.
- So base never tested "B's click cancels A's pending reveal". Its I14 checks held only for a moment, and the press could land on a page the reveal had scrolled back.
- With `runFor(600)` before the placement, the reveal is spent while A's confirm is already in view (`nearest` is a no-op). The checked geometry then persists to the press.
- That end state matches what a real user's wheel-scroll produces (the timer is cleared). The switch assertions themselves are unchanged: both presses on B, a row-top delta under 2px, one confirm, and the I15 reveal.
- `runFor(600)` is far below the 60s label tick. Labels stay fresh, and the `FRESH_LABEL` assertion still runs.

**5. If the font stylesheet fails to load, the tests fail loudly. I checked this myself.**
- With `page.route(/fonts\.googleapis\.com/, r => r.abort())`, the head helper throws after 10s:
  `waitForWebFonts: web fonts did not settle within 10000ms for the target row: {"settled":false,"stylesheetMedia":"print","status":"loaded","loadingFaces":[],"rowFamilies":[]}`
- The 10s bound is the helper's own deadline, inside the unchanged 30s test timeout. No test or expect timeout was raised and no retries were added (driver constraint).
- Is this an acceptable CI risk? Yes, with a note (see the notes below):
  - It triggers only when the Google Fonts CSS request itself fails or takes more than 10s. The same outage also breaks fonts for prod users.
  - The message names the cause precisely.
  - The trade it replaces is a silent ~3% flake on every run.
  - Design D3 sanctioned the "fail loudly" branch.

**6. Static gates on the changed e2e files:** `tsc --noEmit -p e2e/tsconfig.json` exit 0, `prettier --check` clean, `eslint --max-warnings=0` exit 0.

**7. Other claims checked.**
- The cycle-1 failing runs are kept under honest names (`after-repeat30-attempt1-268of270.log`, etc.).
- `call-sites.txt` matches the head's line numbers (I checked by grep).
- The optional product AC is a recorded non-goal (ticket "Driver additions", proposal Non-goals).

### Verdict: CONFIRM

### Non-blocking notes
- **The D3 "undetectable" conclusion rests on a non-sequitur.** evaluation-1 argued that a failed stylesheet cannot be told apart from the page because "a font-file abort also gives status 0".
  - But probe-d3.log shows the discriminator is `media`, not status: abort-css gives `media:"print"` plus a completed `fonts.googleapis.com` resource entry, while a success flips to `all`.
  - "Resource entry present and `media` still `print` across a couple of polls" would let the helper treat a CSS outage as settled (no swap can happen), which keeps the old pass-on-fallback behaviour.
  - Worth a follow-up only if a Google Fonts outage ever reddens CI. The current loud failure is acceptable.
- design.md does not mention the A-reveal / `runFor` ordering. The spec comment at `:172-176` carries it. One line under design Risks before archiving would keep the archived change self-describing (the evaluator made the same suggestion).
- The evidence directory commits ~430 lines of scratch probe specs as `.txt`. That is acceptable as evidence, but heavy for an archive.
