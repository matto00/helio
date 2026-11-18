## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 3ade2cf2f18967097d868accd4fe61fa23b5483e. Base: f2358c16d0fcd87a7bac9bebbd80e02a61855ad0, resolved live with `resolve-review-base.sh` (exit 0). Evidence root (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/skeptic-final/` (called EV below).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed READY (ambient /home/matt/Development/helio, branch bug/refresh-during-first-load/HEL-1738).
- **Diff read in full** (`git diff f2358c16d...HEAD`). It touches 3 production files:
  - `usePanelData.ts` adds `queueRefresh`, `drain`/`dropQueued`, a mounted ref, `ownRequestIdRef`, and `isRefreshing = isLoadingMore || queued`.
  - `MobilePanelStack.tsx:79` registers `panelData.queueRefresh`.
  - `pullRefreshRegistry.ts` has comment changes only.
  - Two prop interfaces omit `queueRefresh`, and test mocks were updated.
  - There are no CSS, token or markup changes.
- **Hook logic, reviewed by hand:**
  - `refresh()` still drops a call made while a request is in flight. That keeps poll, SSE and the per-panel control unchanged, as the spec's "Per-panel triggers are unchanged" requires.
  - `queueRefresh` coalesces repeat calls on the synchronous `queuedRef`.
  - `drain` runs at `.finally` only when this request is still the latest one for the panel. When a newer request came from another sender, it waits on that request through `subscribeWait`. When the newer request is this hook's own, that request's `.finally` drains instead.
  - The CROSS_FILTER retry is returned from `.catch`, so `.finally` waits for it.
  - `queued` is cleared only right after the next dispatch, or by drop on binding loss or unmount. So `isRefreshing` has no false frame between the two requests.
  - I found no path that strands the queue or doubles a request that the existing tests and the evaluator-3 probes P1-P6 do not cover.
- **AC 1 (the chosen behaviour on phone and desktop, light and dark):**
  - The design picks Queue (design.md D1).
  - The full spec file `e2e/hel1738-refresh-during-first-load.spec.ts` ran 7/7 green against the running app at HEAD (EV/e2e-run1.txt). It covers phone 375 and 430 (touch), plus a 375 non-touch desktop browser, each in light and dark.
  - Each of those runs asserts:
    - no request is sent while the first loads are held;
    - exactly N queued requests follow, never two at once per URL;
    - the button stays `aria-disabled` until they settle;
    - the status log is exactly ["Refreshing", "Refreshed"];
    - the total is 2N, with no pipeline-run POST.
  - At 1280 there is no button and the first load sends 3 requests.
  - A second, unmutated run of the same spec (with one extra screenshot) was again 7/7 green (EV/e2e-queued.txt).
- **AC 2 (an e2e that fails first, gated on real readiness signals):**
  - Readiness and every later step wait on route-held request counts and `requestfinished` events. Nothing waits on a skeleton or spinner.
  - I confirmed red-first myself without touching any worktree source. A scratch config and a scratch copy of the spec rewrite the dev server's transformed module in the browser only, using `page.route` + `route.fulfill`.
  - **Mutation A** registers `panelData.refresh` instead of `queueRefresh`. That is equivalent to main for the round path: on main `queueRefresh` does not exist, so `queued` is always false and the drain never fires. Result: 6/6 contexts RED at spec line 210, `gates.held.B` expected 3, received 0 (EV/e2e-mutA.txt, EV/mutA.spec.ts.off).
  - **Mutation B** adds `setQueued(false)` inside `drain()`, which opens the false gap. Result: 6/6 RED at line 211, `aria-disabled` expected "true", received "" (EV/e2e-mutB.txt, EV/mutB.spec.ts.off).
  - These match the executor's red-first-evidence.md.
- **AC 3 (hel1681 stays green):** I ran three full files together: hel1738, `hel1681-refresh-control.spec.ts` and `hel1656-pull-to-refresh.spec.ts`. Result: 39/39 passed (EV/e2e-run1.txt). This was on the lane DB helio_hel1738, with DEV_PORT=7170 and BACKEND_PORT=10077, 2 workers and nice 19. I confirmed the servers on 7170 and 10077 were this worktree's own processes (cwd checked under /proc) and that they served the `queueRefresh` code. Throwaway users were cleaned up by the registry teardown in every run.
- **Jest:** `usePanelData|pullRefreshRegistry|MobilePanelStack` gave 16 suites and 117 tests, all green, at 3 workers, run separately from e2e. Typecheck, `eslint --max-warnings=0` and prettier on the changed files were also clean.
- **UI judgment:**
  - The change adds no visual element. It only lengthens how long the existing HEL-1681 busy cue (spinner in the accent-ringed button) is shown.
  - I looked at screenshots taken during the queued phase (step 4) and after settling:
    - EV/shots-queued/queued-touch-375-light.png
    - EV/shots-queued/queued-touch-375-dark.png
    - EV/shots-queued/queued-touch-430-dark.png
    - EV/shots-queued/queued-mouse-375-light.png
    - EV/shots-queued/settled-touch-375-dark.png
  - The busy spinner and the settled refresh icon match between light and dark. The layout does not shift.
  - In the dark step-4 shots the chart bars are empty or growing. That is the chart's own entrance animation right after the first load landed (motion "full"). It is not caused by this change: the settled dark shot shows bars.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-3.md` is untracked in the worktree. The orchestrator should commit it with the other artifacts.
- The evaluator's mutations M12 (hand off even for this hook's own newer request) and M13 (retry id not recorded as own) still survive the tests. These are narrow rebind/retry interleavings, and my reading of the code finds them correct. A future test could kill them.
- Step 5's "no further request" check reads the count two animation frames after the round ends. That is a short window. A late, unexpected third request would not be caught.
- No gate defect. No evidence used here depends on mtime ordering. Red/green is shown by assertion output and the mutated module text.
