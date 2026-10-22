## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 4f729eed7dd52150f056b6f5a20eac856cb794a7 (= origin/main named in the brief; change dir untracked).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/draft-edit-latency-flake/HEL-1691`.
- **The measured interval is one main-thread task: holds.** The filter value is a controlled `TextField` whose `onChange` calls
  `handleConditionChange` (`frontend/src/features/pipelines/ui/stepConfigs/FilterConfig.tsx:130-137`), which reaches
  `setOverlay` in `usePipelineDraft.ts:81-85`. The draft walk runs in `useMemo` during render (`usePipelineDraftFrames.ts:81-136`).
  It is not in a transition, `useDeferredValue`, timer or worker. React 19.3 (`frontend/package.json:25`) runs a discrete `input`
  update at SyncLane, either inside `dispatchEvent` or in the microtask right after it. The MutationObserver callback is also a
  microtask, so `start` and the observer callback are in the same task (the CDP `Runtime.callFunctionOn` task). One small
  correction to design.md's wording: the render can run in the microtask checkpoint rather than literally inside
  `dispatchEvent`. The conclusion does not change. Also inside the window: the passive effect `writeKeptDraft` (JSON plus
  sessionStorage, `usePipelineDraft.ts:69-77`). React flushes sync-lane passive effects at the end of the commit, so that work
  is app work in the window too, and the trace will show it.
- **Line references:** `timedFilterEdit` is at `e2e/hel1631-draft-mode.spec.ts:128-160`, not 120-148 (nit). The test is at
  :177 and the assertions at :198-200. StrictMode is at `frontend/src/main.tsx:113`. HEL-1631 design.md:177 does record
  `relax-cold-first-edit`.
- **CI layout: holds.** `.github/workflows/ci.yml:549-701` has 4 matrix legs on `ubuntu-latest`. Each leg has its own Postgres
  service, `scripts/e2e-backend.sh start` (sbt run), `npx vite` (dev server) and Playwright with `workers: process.env.CI ? 2`
  (`playwright.config.ts:150`) and `retries: 0` (:139). Triggers are `push: main` and `pull_request: main` only. Every run
  uploads `test-results/results.json`. Only failed runs upload `test-results/`. Shard placement is by weight
  (`scripts/e2e-shard.mjs`), not fixed, so "the shard that runs this spec" has to be read from the run.
- **CDP can deliver D1–D2 from inside a test: holds.** I ran a probe under the e2e flock with `nice -n 19`, using the repo's
  `playwright-core` (Chromium 140.0.7339.186) through `page.context().newCDPSession(page)`:
  - `Performance.getMetrics` exposes `TaskDuration`, `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`,
    `V8CompileDuration`, `DevToolsCommandDuration`, **`ThreadTime`** and **`ProcessTime`**. design.md's "if Chromium exposes it"
    risk is retired. Note that getMetrics has no GC metric, so proposal.md's "GC" in the D1 breakdown can only come from D2.
  - `Tracing.start` with D2's categories plus `blink.user_timing`, in `ReportEvents` mode, returned 286 complete events carrying
    `tdur`, and GC events (`MinorGC`, `V8.GCScavenger`, …). `console.timeStamp` instants carried both `ts` and **`tts`**, e.g.
    `e1-start tts=16753 ts=…018557` and `e1-end tts=23422 ts=…027362`. A window's wall time and thread time can therefore be
    read directly from the two marks. `performance.mark` shows up only because I added `blink.user_timing`. That category is not
    in D2's list.
- **Scope and constraints:** C1 is recorded in workflow-state and tasks.md. The proposal's non-goals exclude relaxing the
  budget, retries and HEL-1632. Reruns are framed as diagnostic samples on the unchanged budget, with every result listed. That
  is consistent with "No retries".

### Verdict: REFUTE

The diagnostic approach is sound and feasible. The decision logic and the AC coverage have gaps that an unattended overnight
executor would have to fill with its own judgment.

### Change Requests

1. **D5 does not map every D3 outcome to an action** (design.md D3/D5, tasks.md 3.x). D3 has three outcomes and D5 has two
   branches. Specify:
   - (a) **GC-classified edits.** GC whose allocation is on the edit path, or is otherwise page/app allocation, goes to the
     app-work fix. State what happens when it is not, for example allocation by the test's own instrumentation.
   - (b) **CPU-dominated edits that are neither GC ≥ 50% nor script-dominated.** Examples: style or layout, `V8.Compile*`, or
     "other".
   - (c) **CPU work that only exists in the dev build.** Examples: StrictMode double-invoking the `useMemo` draft walk, or
     React dev warnings. Fixing that is a measurement-environment question (dev vs prod build), not an app fix, so it must go to
     the owner under C1 / the proposal's "measurement scope" non-goal. Say so explicitly.
   - (d) **Mixed results across runs.** For example, one run is contention and another is app work. The ticket's three failing
     runs already look different from each other: single spikes vs. a sustained five-edit slow period. Suggested rule: fix any
     app-work share, then escalate whatever contention remains.
2. **Define the D2/D3 interval exactly** (design.md D2). "Maps each edit's window to the renderer main thread's top-level
   tasks" can be read as task-level `dur`/`tdur`. Those cover the CDP evaluate overhead and any trace-buffer work, not the
   asserted interval. Specify the following:
   - bracket the timed interval with `console.timeStamp` marks (one immediately before `setter.call`, one in the observer
     callback);
   - per edit, wall = Δ`ts` and thread = Δ`tts` between those marks;
   - GC and script time = the events that overlap that interval.

   If `performance.mark` is used, add `blink.user_timing` to the category list. The probe confirmed that instants carry `tts`.
   The marks must not change the asserted `performance.now()` interval.
3. **Separate tracing's own cost from app work on CI** (D3/D4, Risks). The only planned check is a local with/without-tracing
   comparison, but the perturbation that matters is on the 4-vCPU runner. Trace-recording overhead counts as renderer thread
   time, so D3 would classify it as CPU and therefore as "app work". Require one of these:
   - some CI samples with D2 off, classified using D1's `ThreadTime`/`TaskDuration` deltas (confirmed available), so wall vs.
     thread time is measured without tracing;
   - or an explicit statement of how a traced over-budget edit is checked against the traced passing-run baseline before it is
     called app work.
4. **AC2 has no task** ("green on main across 10 CI runs, or the owner has ruled"). Task 3.1 only says "passes locally and on
   CI". State how AC2 gets closed in the app-work branch: how many PR runs are collected pre-merge, and who observes the 10 main
   runs after merge and where that is recorded. In the contention branch, AC2 is the owner ruling; say that the run stops at
   the escalation.

### Non-blocking notes

- Fix design.md's line range for `timedFilterEdit` (128-160) and the "synchronously inside `dispatchEvent`" wording (sync lane;
  same task either way).
- Playwright's `browser.startTracing(page, {categories, path})` (Chromium-only) is a simpler alternative to a hand-rolled
  `Tracing.start` + `IO.read`. Either works.
- The trace file is uploaded only when the job fails (`ci.yml` "Upload Playwright report on failure"). An edit over budget on a
  run that is otherwise green does not happen here, because max > 50 fails the test. Still, make sure the summary line reaches
  stdout before the assertions, so it lands in `results.json` either way.
- In D4, "the shard that runs this spec" is weight-partitioned. Identify the leg from each run's logs rather than assuming it
  is shard 3.
