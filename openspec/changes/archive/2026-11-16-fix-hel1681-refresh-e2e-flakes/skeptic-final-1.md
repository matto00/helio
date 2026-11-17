## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 2ff99ff699fc089c9c22084fc6ff572b30033b60. Base resolved live with `resolve-review-base.sh` (main/origin): 1d2fa5ab1c8a7e84a7e662a6181a893c52d6236d.
Code diff: `e2e/hel1681-refresh-control.spec.ts` only (+36/-12). Everything else is change-dir artifacts. No product code and no UI changed, so step 4 (design judgment) does not apply.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/hel1681-refresh-e2e-flakes/HEL-1731`.
- **Root cause traced in product code, not taken from root-cause.md:**
  - `frontend/src/features/panels/ui/usePanelData.ts`: `refresh()` starts with `if (inFlightRef.current) return;`.
  - `frontend/src/features/panels/ui/grid/pullRefreshRegistry.ts:104-111` seeds `seen: entry.isRefreshing` and then calls `entry.refresh()` on every entry. A comment there says an in-flight panel's refresh is a no-op.
  - So a press made while the initial loads are still in flight sends 0 new GETs, and the round ends when those loads land. That explains both CI symptoms: `Expected: 3 / Received: 0`, and `aria-disabled` never seen as `"true"`.
  - This is intended product behaviour, so fixing the test's wait (not the product) is correct, per design D4's fix rule.
- **The fix waits for the real precondition.** `countRequests` tracks rows GETs in an in-flight set and removes each one on `requestfinished` or `requestfailed`. `openDashboard` (spec :86) polls until that set is empty, then waits two animation frames. This check cannot pass vacuously: it comes after `seen.urls.length >= 3` (:80), so the requests have already started. No timeout was lengthened.
- **AC1, no bare stack-item measurement before `waitForPanelStack`:**
  - `openDashboard` :77 calls `waitForPanelStack(page, 4)`. The helper in `e2e/support/panelGridReady.ts:54-61` waits for a live-layer count, then for `getByLabel("Loading panels")` to reach 0. That label sits on `PanelGridSkeleton.tsx:30`.
  - The Full-motion read (:328) uses `LIVE_STACK_ITEMS` and throws a clear error on a null box.
  - The shift sampler (:270-281) is now scoped to the live layer.
  - The remaining stack-item reads are `--output`/`--markdown` selectors, which the skeleton never renders, and all run after the wait.
  - The SIZES are 375 and 430, both phone widths, so `waitForPanelStack` is the right helper.
- **AC2, the count check can fail:** the 1280 count-0 check (:357) now runs after `waitForPanelGrid(page, 3)` (:356), a positive anchor. I did not run the mutation myself. The evaluator's pasted result is unambiguous: the new order went red 2/2 with `Expected: 0 / Received: 1`, while the old order went red only 1 of 2, which shows it was vacuous. I accepted that result, and the reorder makes the mechanism plain.
- **Red-first under forced repro (driver addition):** I did not re-run this. Two independent agents report it with the CI error text:
  - Executor: keyboard test 6/6 red at each delay from 800 to 1300 ms; the tap-test variant red with `aria-disabled` `Received: ""`.
  - Evaluator: old spec 8 red of 12, `Expected: 3 / Received: 0`; new spec green under the same forcing.
  - My own code trace above independently confirms the mechanism.
- **Static gates (my own runs):** `npm run check:e2e-types` exit 0; `eslint --max-warnings=0` on the spec exit 0; `prettier --check` exit 0.
- **Repeat runs at workers 2, `nice -n 19`, servers 7163/10070 (`assert-phase.sh servers`: `PASS servers`), my own runs:**
  - Whole spec `--repeat-each 20`: **294 passed, 6 failed (16.0 m), load average 6 rising to 18.2.** Other lanes were running concurrently. I read every failure:
    - 2 failures (single tap @430 r7, keyboard @430 r7): the error-context snapshots show the app's error boundary, `Failed to fetch dynamically imported module: http://localhost:7163/src/features/panels/ui/ChartPanel.tsx`. The Vite dev server dropped a module request.
    - 2 failures (crossing r7, second activation @375 r11): `page.goto("/login")` or `page.fill('#email')` hit the 30 s test timeout inside `login()`, before the code under review runs.
    - 2 failures (no-button @375 r7, shift @375 r7): the page did not render the markdown card or the button within 5 s. The no-button test is untouched by this diff. The shift failure is at `toBeVisible`, not at the changed sampler.
    - Five of the six fall in the same repeat-7 window. None shows a signature this ticket targets: no `Received: 0` request count, no `aria-disabled` never `"true"`, no null-box TypeError.
  - Re-run of the targeted tests (`-g "single tap|keyboard|second activation|Full motion"`) with `--repeat-each 20`: **140 passed, 0 failed (8.6 m), load average 14.0 falling to 10.4.**
  - I treat the 6 as an unstable environment, not a defect. They reproduced as dev-server and load failures, and the targeted area was 140/140 under load that was still heavy.
- **Sweep (D5):** I checked `sweep.md` against the file. Every `mobile-panel-stack` hit has a verdict, and the reasoning holds: the crossing test's count-0 follows a count-1 anchor, and the tap test's `toHaveCSS` runs after `openDashboard`.

### Verdict: CONFIRM

### Non-blocking notes
- The executor's own `--repeat-each 20` result (task 3.1) is not in any change-dir file or persisted evidence. Task 3.1 is checked off without its pasted output. My own runs above stand in for it.
- `root-cause.md` "Green after" points to a "final repeat-each result in the report" that does not exist (the evaluator noted this too).
- The whole-spec runs show that, on a loaded machine, this spec is still exposed to Vite dev-server module-fetch failures and login-page load timeouts. These are outside this ticket and not specific to this spec. On CI, `HELIO_E2E_PROD_BUILD` and its lower contention make them unlikely.
