## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 3086fdb717991b1c08c345966149536c481f6dfc (base 609e62b6d, resolved live via resolve-review-base.sh).
Diff: one file, `openspec/changes/fix-crossfilter-echarts-flake/measurements.md` (+65). No code change.

### Phase 1: Spec Review — FAIL

What holds up:
- The D4 bounded-effort counts are met as written: 30 cold-cache CI=true single-file runs plus 5 contended
  full-suite runs, all passing. My spot-check agrees: 5 more cold runs (fresh `--cacheDirectory` each,
  `CI=true nice -n 19 --maxWorkers=1`) gave 5/5 passes at 6.4-7.1 s each.
- The CI-log facts are correct. I pulled run 38553599277 with `gh run view --log-failed`. It has one
  failure at `PanelCard.crossFilter.test.tsx:369:37`, the grid `findAllByTestId`. The DOM shows
  `chart-panel__canvas` still holding `suspense-fallback suspense-fallback--panel`. The suite took 219.17 s
  across 596 suites and 7131 tests. The second FAIL block is jest's summary reprint.
- The artificial busy-wait claim reproduces. In a throwaway detached worktree I made a scratch edit that
  busy-waits D ms inside the `./echartsCore` mock factory, with the timestamp set in the chart test itself.
  The factory ran 25 ms after render, loaded from ChartPanel.tsx. D=1200 gave visible at 1243 ms and a pass;
  D=0 gave 313 ms. A synchronous block inside the lazy `require` does not fail the test.
- The XHR attribution (metric-describe tests, unmocked axios) is plausible and is labelled as not tied to the
  failure.

Issues:
1. **The central refutation is overgeneralised, and the D4 "not reproducible" path was not legitimately
   reached.** The report says H1 is "refuted as a sufficient mechanism: the CPU-bound slow-transform cost
   cannot by itself produce the CI symptom". It also says the failure "requires the chart's lazy
   resolve+commit to complete later than ~1000 ms via an asynchronous path ... not merely a slow synchronous
   module load". The experiment only placed the stall inside the lazy `require`, which runs after React has
   already started the import. A synchronous stall placed one step earlier reproduces the exact CI symptom
   deterministically. The stall was a 1200 ms busy-wait in the `getOutputById` mock's resolution microtask,
   which runs after `findAllByTestId` has armed its 1000 ms timer and before the lazy `ChartPanel` mounts.
   Scratch probe in the test (never committed; throwaway worktree removed):

   ```ts
   getOutputByIdMock.mockImplementation(() =>
     Promise.resolve().then(() => {
       const end = Date.now() + Number(process.env.EVAL_META_BUSY_MS || 0);
       while (Date.now() < end) {}
       return out;
     }),
   );
   ```

   - Run alone (`-t "SAME narrowed"`, CI=true, nice -n 19, maxWorkers=1), EVAL_META_BUSY_MS=1200: **3/3
     FAIL**. It is `Unable to find an element by: [data-testid="echarts"]` at the grid `findAllByTestId`
     line. The DOM shows `chart-panel__canvas` > `suspense-fallback suspense-fallback--panel`, which is the
     same DOM as the CI dump. The ChartPanel graph loads (echartsCore factory) about 1258 ms after render.
   - Whole file, same stall: 2/2 FAIL at the same assertion. Here the DOM is the output-meta loading state
     (`panel-content--state`), not the chart Suspense fallback. So whole-file and isolated runs differ in how
     far React gets before the timer fires. That difference is worth reporting too.
   - Same stall inside the lazy `require` (the executor's placement): pass.

   So any main-thread stall of about 1 s that lands between the `findBy` timer arming and the lazy chart
   mount reproduces the CI DOM. Examples are a GC pause, CPU starvation of the worker on a contended 4-vCPU
   runner, or transform/eval work on that path. The lazy fallback then has to wait out React's 300 ms reveal
   throttle, which is scheduled after RTL's already-overdue timeout. This is a probe-reproducible mechanism.
   D5 explicitly accepts an artificial-latency variant to demonstrate a fix.

   The D4 precondition reads "the probe cannot push render-to-visible near 1 s". Its intent is that the
   failure cannot be produced. That intent is not met: it can be, with the stall placed where CI shows it.
   The report's conclusion that an asynchronous path is required is also contradicted by its own
   "event-loop starvation" wording. Starvation is a synchronous stall, and placed before the import it is
   enough.
2. **tasks.md is not updated.** Items 1.1-1.9 are all `[ ]`. The completed probe items (1.2-1.6) are not
   ticked, and the items this path skips (1.7/1.8) are not marked N/A with a reason.
3. **D5's "exact commands" requirement is not met.** measurements.md describes the flags in prose but never
   gives the literal command lines for the 30-run loop, the full-suite runs, the `-t` runs, or the busy-wait
   variant. A reader cannot re-run the protocol exactly.
4. **Task 1.1 (CI jest command and cache state) is not recorded.** The CI step runs `npm test`, which is
   `jest && npm --prefix frontend test` (root jest first, then the frontend suite). `CI=true` means there is
   no local cache cap (default cache dir, cold on a fresh runner). The report gives only the 219 s wall time.

CONSTRAINTS check: C1 is honoured (no timeout/retry). C2: my spot-checks show the stated flags are
plausible, and the measurements.md header says everything ran in this worktree. C3 is honoured in form,
since timings are render-to-visible, but see issue 1.

### Phase 2: Code Review — PASS

Changed files are `openspec/**` only, so the `frontend/**` and `backend/**` gate triggers do not match and no
gate is required. As a fresh check, `npx prettier --check` on measurements.md passes. No code, tests or
standards surface changed.

### Phase 3: UI Review — N/A

No UI-affecting files changed, as the orchestrator directed.

### Overall: FAIL

### Change Requests

1. **Re-open the probe with the stall placed before the lazy mount** (design D1/D5). Add a scratch,
   never-committed variant that busy-waits about 1.0-1.5 s in the `getOutputById` mock's resolution
   microtask, i.e. after `findAllByTestId` arms its timer and before ChartPanel loads. Record pass/fail over
   N runs, both isolated (`-t`) and whole-file. Also record the failure DOM for each: the isolated run
   matches CI's `chart-panel__canvas` > `suspense-fallback--panel`; the whole-file run shows the meta-loading
   state. Give the exact commands.
2. **Correct measurements.md's verdict section.** Narrow the H1 refutation to "a stall inside the lazy
   `require` is absorbed". Remove or rewrite the claim that an asynchronous path is required, and that
   CPU-bound cost "cannot by itself produce the CI symptom". State the reachable mechanism: a stall of about
   1 s before the lazy mount, then the 300 ms Suspense reveal throttle after the overdue RTL timeout. Keep
   labelling the CI stall source as unconfirmed.
3. **Re-decide the outcome under D2/D5 with that artificial reproduction as the "before" condition.** If a
   test-only fix removes the timing dependency (for example, initialising the lazy `ChartPanel` before the
   timed render so the fallback and throttle never enter the window), prove it with the same stall: before
   = failing N/N, after = passing N/N. Also show the render-to-visible and fallback-shown flag in the
   unstalled condition (C3). This is not a raised timeout or a retry, so C1 holds.
   - Caveat from my own probe: a warm-up render in the same test made the timed render skip `getOutputById`
     (meta appears cached), so it never hit the stall. A valid "after" must still pass the stall through the
     timed render.
   - If you judge the CI stall source too unconfirmed to justify a fix, say so explicitly. Then keep the
     no-code outcome, but only with the corrected mechanism from CR2.
4. **Update tasks.md checkboxes:** tick completed items and mark skipped ones N/A with a reason.
5. **Add the literal commands to measurements.md** for every condition (D5), and the CI step's jest
   invocation and cache state (task 1.1).

### Non-blocking Suggestions

- The two metric-describe tests' unmocked `getOutput`/history XHRs (ECONNREFUSED) are noise in every run.
  Mocking them is a cheap follow-up candidate, separate from this ticket.

Evidence note: every probe above ran in a throwaway `git worktree add --detach` copy at 3086fdb71 under the
session scratchpad, with a copied `frontend/node_modules`. Each run was sequential and used `CI=true nice -n 19
--maxWorkers=1`. The copy was removed with `git worktree remove --force` afterwards; `git worktree list` shows
no straggler. The delivery worktree was not modified. The claims rest on pass/fail outcomes and DOM content,
not on file mtimes.
