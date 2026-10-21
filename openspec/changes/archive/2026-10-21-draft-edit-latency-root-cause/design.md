## Context

See proposal.md for why. Ground truth (origin/main 4f729eed7):

- `timedFilterEdit` (`e2e/hel1631-draft-mode.spec.ts:128-160`) sets the filter input with the native setter, dispatches
  `input`, and resolves when a MutationObserver on step 1's `.spine-row__count` sees new text. React handles `input` as a
  discrete event at SyncLane (React 19.3; `FilterConfig.tsx` onChange -> `usePipelineDraft` `setOverlay` -> synchronous
  `useMemo` walk in `usePipelineDraftFrames.ts`; no transition, deferred value, timer or worker), so the render and
  commit run inside `dispatchEvent` or the microtask right after it; the observer fires in that same task's microtasks. The measured interval is therefore one main-thread task: anything that delays it is either work
  in that task (app code, React dev-build overhead, GC) or the renderer thread not being scheduled.
- CI e2e (`.github/workflows/ci.yml` `e2e` job): one `ubuntu-latest` runner hosts Postgres, `sbt run`, the Vite dev
  server and 2 Playwright workers. The app runs as a development build under `<React.StrictMode>`
  (`frontend/src/main.tsx:113`).
- Shard placement is weighted (`scripts/e2e-shard.mjs`): the leg that runs this spec is read from each run, not
  assumed to be shard 3. CI triggers only on `pull_request` and main pushes. Failed-run artifacts: `test-results/` (failure only);
  `test-results/results.json` (always, includes test stdout).
- HEL-1631 design.md:177 records the edit-1 cold-compile cost and the owner ruling `relax-cold-first-edit`.
- CI data so far (ticket.md): one run had five consecutive edits at 62-85 ms, which a single GC pause does not explain.

## Goals / Non-Goals

Goals: a CI-side, per-edit attribution of the slow edits; then either a fix of app work, or an owner escalation.
Non-goals: see proposal.md. In particular the assertion lines (`latencies[0] < 100`, `max(edits 2-10) < 50`) do not
change in this change unless the owner rules.

## Decisions

**D1 — Per-edit CPU-vs-wall breakdown via CDP, logged on every run.** Around each `timedFilterEdit`, read CDP
`Performance.getMetrics` (cumulative `TaskDuration`, `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`, and
`ThreadTime` if Chromium exposes it) before and after, and log one line per edit with wall latency and the deltas. The
deltas include the CDP round-trip's own work, so they are an upper bound on the edit's main-thread work; the trace (D2)
is the precise source. Alternative rejected: only `performance.now()` deltas inside the page — they cannot separate
"thread busy" from "thread not scheduled".

**D2 — CDP trace of the burst during diagnosis.** `Tracing.start` (categories `devtools.timeline`,
`disabled-by-default-devtools.timeline`, `v8`, `disabled-by-default-v8.gc`, `toplevel`) before the first edit,
`Tracing.end` after the last, written to `testInfo.outputPath("hel1691-burst-trace.json")`. **Interval definition:**
inside `timedFilterEdit` the page calls `console.timeStamp("hel1691-edit-<k>-start")` immediately before the setter and
`console.timeStamp("hel1691-edit-<k>-end")` in the MutationObserver callback, i.e. exactly the measured interval. Per
edit: wall = Δ`ts`, thread time = Δ`tts` between the two marks; GC = summed GC event `dur` between them; script, style,
layout and compile time likewise from events between them on the renderer main thread. Not the enclosing task's
`dur`/`tdur` (wrong interval). Summary line logged on every run (pass or fail). Alternative rejected: Playwright's own
trace (`--trace`) records actions and snapshots, not renderer CPU/GC.

**D2a — Tracing's own cost is separated from app work.** Trace overhead is thread time, so D3 would read it as app
work. Therefore CI evidence is collected in two arms: (a) traced runs, (b) runs with tracing OFF (env
`HEL1691_TRACE=0` switch in the spec) classified only from D1's `ThreadTime` (a CDP-exposed thread-CPU metric, probed
present in the repo's Chromium 140). An app-work verdict needs the untraced arm's over-budget edits to show thread time
≥ 50% of wall too; a traced-only finding is reported as tracing overhead, not app work.

**D3 — Classification rule, fixed before looking at CI data.** For each over-budget edit (thread = Δ`tts` from D2,
or D1 `ThreadTime` delta in the untraced arm):
- wall − thread > 50% of wall → **contention**: the renderer thread was runnable but not running (runner CPU).
- thread ≥ 50% of wall, GC ≥ 50% of thread → **GC**.
- thread ≥ 50% of wall, script-dominated → **app work (script)**; name the hot functions from the trace.
- thread ≥ 50% of wall, style/layout/compile-dominated → **app work (render/compile)**.
- Any CPU-dominated finding is also checked for **dev-build-only cost**: work that exists only because CI serves the
  development build (StrictMode double-invoking the `useMemo` walk, React dev checks). Measured by comparing the same
  edits in a local production build (`vite build` + `vite preview`) vs the dev server.

**D4 — Evidence collection on a draft PR.** Push the instrumented branch and open a draft PR (CI runs only on PRs). Collect
the shard that runs this spec at least 6 times (initial run + `gh run rerun --job <id>` of that one e2e job). These are
diagnostic samples, not retries: the test still fails on the unchanged budget and every result is recorded. Download
`results.json` (and, for failures, the trace) into `/home/matt/Development/helio/.concertino/scratch/HEL-1691/`. Also
record a local baseline (unthrottled and under CDP 6x CPU throttle; CDP throttles only the renderer, so it cannot
reproduce runner contention) for comparison.

**D5 — Branch after evidence (the orchestrator decides).** Contention, GC not caused by the edit path, dev-build-only
cost, or no over-budget edit → owner escalation; production-relevant app work → fix; mixed → fix the app share and
escalate the rest. Outcome: dev-build-only cost (evidence.md section 6) → owner ruled `prod-build-measurement` (Revision 2).

**D6 — AC2 closure.** App-work branch: after merge, the orchestrator records the burst test's result on every main CI
run until 10 consecutive runs of this spec have passed (reported in the hand-back; a failure reopens this ticket as a
regression, never a rerun). Contention / dev-build branches: the change stops at the owner escalation; AC2 is the
owner's ruling.

## Risks / Trade-offs

- [Tracing perturbs timing; too few failures; trace cost read as app work] → local with/without-trace comparison, >= 6
  samples per arm, and the untraced arm (D2a). All resolved in evidence.md.

## Planner Notes

- Self-approved: CDP instrumentation inside one e2e spec; a draft PR opened early for CI evidence.
- Not self-approvable (owner): any change to the budget, statistic, or measurement scope.
- Round-2 notes adopted: "dominated" = largest share of thread time; summaries logged before the first `expect`; the
  driver watches the 10 post-merge main runs (D6).

## Revision 2 — owner ruling `prod-build-measurement` (after evidence.md)

Evidence (evidence.md section 6) selected D5's dev-build branch; the owner ruled opted-in latency assertions run against a
production build in CI, budget unchanged (C2). D1-D6 above are the diagnosis record; D7-D11 govern the fix.

**D7 — Opt-in by tag; the env alone picks the build.** A latency test opts in with `tag: "@prod-build"` and nothing
else. `playwright.config.ts`: with `HELIO_E2E_PROD_BUILD` unset, the only project is `dev` (`grepInvert: /@prod-build/`);
with `HELIO_E2E_PROD_BUILD=1`, the only projects are `prod-build-guard` and `prod-build` (`grep: /@prod-build/`,
`dependencies: ["prod-build-guard"]`) — `dev` is omitted, so a dropped or mistyped `--project` in the prod-build job
cannot run dev tests against preview. A bare `npx playwright test`, `npm run e2e`, a file-targeted run and
`playwright.regression.config.ts` (spreads `projects`) follow the same env rule. Same `baseURL` (`DEV_PORT`): preview is
served on that port, so cookies, proxy and origin are identical (`server.proxy` and `shellRoutingPlugin`'s
`configurePreviewServer` apply in preview). HEL-1632's spec opts in later by adding the tag only.

**D8 — Fail-closed build guard, automatic.** `prod-build-guard` is an untagged setup project
(`e2e/prod-build.guard.ts`) that fetches `baseURL`'s HTML with `request` (independent of any test's navigation) and
fails unless the response is 2xx, has no `/@vite/client`, and references a hashed `/assets/*.js` module script. Every
`prod-build` test depends on it, so a tag alone is guarded. Failability: env set against the dev server (red, tagged
tests skipped as dependency failures) and against preview (green); both recorded.

**D8a — Service workers blocked in `prod-build`.** The production build registers the PWA service worker
(`autoUpdate`), which would precache ~4 MB during the test and may take over the page mid-test; the dev baseline never
had one. `prod-build` sets `use: { serviceWorkers: "block" }`, so the measured app matches the dev baseline minus
React's development runtime, and nothing else.

**D8b — Lasting partition check, counted by `projectName`.** `npm run check:e2e-prod-build-projects` runs
`playwright test --list --reporter=json` twice and fails unless: (a) env unset — every listed test's project is `dev`
and none carries `@prod-build`; (b) env set — no `dev` test is listed, at least one `prod-build` test is listed, and
every `prod-build` test carries `@prod-build` (the untagged `prod-build-guard` test is counted separately, never as a
`prod-build` test). Its selftest feeds the pure checker fixtures that violate each rule — including one where only the
guard is listed (red) — and a clean one (green). Both the real check and the selftest run in the CI `frontend` job.

**D9 — Dedicated CI job `e2e-prod-build`, not in-shard.** Structural argument first: no step is added to any e2e
shard; the shards lose one test. The new job mirrors the e2e job's services/backend/setup, runs
`npm --prefix frontend run build`, starts `npx vite preview --port 5173 --strictPort`, and runs
`HELIO_E2E_PROD_BUILD=1 npx playwright test --project=prod-build`, with failure-artifact upload like e2e. Added to
`ci-complete.needs` (`check:ci-complete-needs`). Its JSON report artifact is named `playwright-json-prod-build`
(never `playwright-json-shard-*`: weight regeneration expects exactly the shard reports). Initial `timeout-minutes: 20`, tightened to about 2x the measured
duration in the same PR once measured. `scripts/e2e-shard.mjs` passes `--project=dev` to `--list`, the re-list inside
`run()`, and the run (`check:e2e-shard:selftest` stays green; `e2e/shard-weights.tsv` has no row for hel1631 (it is "defaulted"), so nothing is over-weighted — noted, not changed). **Measured CI cost (task 3.8):** (1) per leg, the sum of test durations from
`results.json` on the PR run vs the median of the last 5 main runs with the same `e2e/shard-weights.tsv` and spec
set; escalate (C2) if any leg's test time grows by more
than 60 s over that median; (2) the new job's queued-to-started delay and duration; (3) whether `ci-complete` finished
later than the slowest e2e leg because of `e2e-prod-build`; escalate if by more than 2 min (account concurrent-job
limit). Alternative rejected: build inside a shard — adds minutes to a leg already near its timeout.

**D10 — Burst test opts in; diagnosis scaffolding trimmed.** `hel1631-draft-mode.spec.ts:177` gets the tag only; the
other hel1631 tests stay on `dev`. Assertions unchanged (C1). The D2 trace capture and the local-only switches
(`HEL1691_TRACE`, `HEL1691_THROTTLE`, `HEL1691_PROFILE`, `HEL1691_OUT`) are removed; the D1 breakdown stays and is
logged before the first `expect` (appending it to the assertion messages would touch C1's lines).

**D11 — Local use.** `npm run e2e:prod-build` (node script `scripts/e2e-prod-build.mjs`): builds, then spawns the
vite binary directly (`frontend/node_modules/.bin/vite preview --port $DEV_PORT --strictPort`, `BACKEND_PORT` passed
through for the proxy), fails at once if the child exits before it answers, runs
`HELIO_E2E_PROD_BUILD=1 playwright test`, and terminates its own child on every exit path (normal, error, SIGINT/SIGTERM)
through the child handle, exiting with Playwright's status. In a lane, the dev server is stopped first with
`scripts/concertino/stop-servers.sh` (or a free port is used), and the port is confirmed free after the run. The full
local suite is `npm run e2e` plus this. `CONTRIBUTING.md`'s e2e section gains the tag and the command.

Risks: [preview differs from Firebase Hosting] → same `dist/`; routing and proxy verified. [New job infra flakes] →
same setup as e2e. [Shard leg variance ~7 min] → D9 compares test time against a 5-run median, not one wall time.
