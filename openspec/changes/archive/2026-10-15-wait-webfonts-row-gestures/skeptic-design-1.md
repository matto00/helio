## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585 (planning artifacts uncommitted in the change dir).

### What I verified (with evidence)

- **Tree facts in design.md Context: confirmed.**
  - `frontend/app.html` loads the Google Fonts css2 stylesheet with `media="print"` and an `onload` swap to `all`.
  - `e2e/support/rowDeleteGesture.ts`: `placeBottomNearViewportEdge` is at :8 and calls `settledRowTop` at :9. `settledRowTop` is at :22. `gotoSettled` is at :175 and only does `goto` plus, for `/sources`, a wait on the references response. It has no row-visible wait.
  - There is no `document.fonts` usage in `e2e/` or `frontend/src`.
  - `playwright.config` sets `retries: 0`.
- **Origin evidence: read.** `HEL-1605 .../skeptic-final-evidence-2/reflow2.log`:
  - `fontloading` fires at about 640-690 ms, which is when the rows render.
  - `fontdone` lists exactly `Schibsted Grotesk 400 900|JetBrains Mono 500`.
  - The 55 to 53 px rect change lands before `fontdone`.
  - A new document (the second `goto`, to /sources) fires `fontloading` again. So the wait has to run once per navigation.
- **The design's expected predicate (D2) cannot be satisfied.** I fetched the exact stylesheet URL from `app.html` with a Chrome UA:
  - `curl ... | grep -c @font-face` returned **34** faces: latin ×8, latin-ext ×8, vietnamese ×6, cyrillic ×4, cyrillic-ext ×4, greek ×4.
  - The overview page loads only the latin faces it actually uses. reflow2.log shows 2 families loading.
  - Chromium loads a face only when rendered text needs it. The other ~30 faces (unused subsets, Fraunces, JetBrains Mono 400/600/italic) therefore stay `unloaded` for the life of the document.
  - D2's clause "no face is `loading`/`unloaded` among the app's web families" therefore never becomes true. The helper as designed would time out on every call, and D3 then fails every row test loudly.
  - D2's non-vacuity clause ("`document.fonts` contains at least one web face") is vacuous too. All 34 faces are registered as soon as the stylesheet applies, whether or not any has loaded.
- **The design misses the real non-vacuity condition: the wait has to come after the target row has rendered.**
  - Font loads start only when text that needs them is laid out.
  - Suppose `status === "loaded"` is read after the stylesheet applies but before the rows render. It reads `loaded` with nothing loading, then flips to `loading` once the rows paint. That is the same vacuity the ticket warns about for `document.fonts.ready`.
- **Call-site coverage (D4).** I mapped every double-click gesture in both specs:
  - hel1574 :387 goes through `placeBottomNearViewportEdge` (:381) after a bare `goto` (:374).
  - hel1574 :536 goes through `gotoSettled` (:522) and `placeBottomNearViewportEdge` (:530).
  - hel1605 :182 goes through `gotoSettled` (:156) and `placeBottomNearViewportEdge` (:171).
  - hel1605 :236 (I19) goes through `gotoSettled` (:216) then `settledRowTop` **directly** (:225).
  - hel1605 :287 and :307 (I17) go through `gotoSettled` (:273) then `settledRowTop` **directly** (:281).
  - hel1605 :82 (I4/I6) goes through `gotoSettled` and `placeBottomNearViewportEdge`.
  - So I19 and I17 are covered only by the `gotoSettled` placement. D4 says that placement runs "after the route's rows render", but `gotoSettled` has no locator and no row wait. For `/pipelines` it returns at the load event, which can be before the rows are fetched and rendered. As specified, those two tests can pass the wait vacuously.
  - `settledRowTop(button)` is the one function every row double-click gesture already goes through, and it holds a row locator.
- **Fake clock interaction (not covered by the design).**
  - `installFreshClock` (`page.clock.install`) runs **before** navigation in hel1574 :373/:516 and hel1605 :155/:267.
  - Playwright's clock fakes `setTimeout`/`requestAnimationFrame` in the page.
  - The helper uses `page.waitForFunction`, and its polling under an installed fake clock has not been shown to keep running.
  - The design names no check for this, and its forced-delay repro (D5) does not say it must use a clock-installed test.

### Verdict: REFUTE

The design's process is sound: D1 probe-first gating, bounded and loud failure, red-then-green forced-delay measurement, no retries or timeouts, scope kept to the test harness. But the concrete predicate and the wait placement it hands the executor are wrong in ways the tree shows today. The executor is told to "confirm D2 by D1", so it should be pointed at the right target before it starts. All revisions below are artifact edits.

### Change Requests

1. **design.md D2: replace the predicate.** Drop "no face is `loading`/`unloaded` among the app's web families" and "contains at least one web face".
   - Why: 34 faces are registered and about 30 stay `unloaded` forever (curl count above), so the first clause never passes and the second is vacuous.
   - The predicate must be evaluated **after the target row is visible**, and must hold: stylesheet `media === "all"`, **and** no face in `loading`, **and** `document.fonts.status === "loaded"`. `unloaded` faces are allowed.
   - Optionally, also require that the faces the row actually uses are `loaded` (or `error`). The probe should name them; reflow2.log shows Schibsted Grotesk 400-900 latin and JetBrains Mono 500 latin.
   - Note in D1/D2 that the probe must confirm Chromium moves `status` to `loading` by the time Playwright reports the row visible. That is, there must be no gap between the row being laid out and the face request starting.
2. **design.md D4 and tasks.md 2.2: put the wait at the row-aware choke point.**
   - Call `waitForWebFonts` at the start of `settledRowTop(button)`, after the button resolves. The helper can take the page from `button.page()`.
   - Alternatively, give `waitForWebFonts` a required row/locator argument that it waits visible first.
   - Do not rely on `gotoSettled`, which has no row signal. That is the only path covering hel1605 I19 (:225/:236) and I17 (:281/:287/:307).
   - Update tasks 2.2 to list these call sites explicitly, alongside hel1574 :374/:381 and :522/:530 and hel1605 :95/:100 and :156/:171.
   - Per navigation: the wait must re-run after every `goto`. hel1605 :82 and hel1574 :477 navigate twice per test, and reflow2.log shows a second `fontloading` on the second document.
3. **design.md D3/D5 and tasks 1.2/2.3: account for the installed fake clock.**
   - State that the helper must work under `page.clock.install` (all four double-click tests that age labels install it before `goto`).
   - Require that the forced-delay red/green repro (tasks 1.2/2.3) runs on at least one clock-installed test, for example hel1605 I17 or the hel1574 :351 test. Otherwise a `waitForFunction` that stalls or passes trivially under the fake clock would go unnoticed.

### Non-blocking notes

- D3 makes "stylesheet never applied" a hard failure. A Google Fonts outage in CI would then turn these specs red, where today they pass on the fallback stack. That is a defensible choice (fail loud rather than flake), but consider treating a stylesheet `error` event as settled, since no swap can follow it. Whichever way it goes, state the choice in the PR.
- `pwaConfig.ts` runtime-caches fonts.googleapis/gstatic. If any e2e run serves a production build with the service worker active, a second page in the same context would see fonts arrive from the SW cache almost instantly. That is harmless for the wait, but worth knowing when reading probe timings.
- Proposal "What Changes" says the 375/1280 test "and the HEL-1604 test use it too". With CR2 this follows automatically through `settledRowTop`, and no spec-file edits may be needed.
