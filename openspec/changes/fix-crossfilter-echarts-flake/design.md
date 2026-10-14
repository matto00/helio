## Context

- `ChartRenderer.tsx:19`: `const ChartPanel = lazy(() => import("../ChartPanel").then(...))` (HEL-512 code split).
  In jest the dynamic `import()` becomes a `require` of `ChartPanel` and its graph, ts-jest-transformed on first load
  unless the transform cache already holds it.
- The failing test (line 350) is in the last describe of `PanelCard.crossFilter.test.tsx`; every earlier test renders
  table/metric panels, so this test is the first in its file (fresh module registry per file) to load `ChartPanel`.
- It waits with `screen.findAllByTestId("echarts")` at line 369 — RTL's default 1000 ms `asyncUtilTimeout`.
- CI (`CI=true`): `localJestCaps` returns `{}` (default cache dir in os.tmpdir, cold on a fresh runner), jest default
  workers = 3 on a 4-vCPU runner. Locally: on-disk `.jest-cache/`, usually warm, which can mask a cold-transform cost.
- CI logs: one failure per run in two independent runs (38553599277; PR #1023's 38567142582 attempt 1), each a
  single jest invocation, both at 369:37, both DOMs showing the `suspense-fallback--panel` skeleton in
  `.chart-panel__canvas`. The suite also logs jsdom XHR `AggregateError`s
  (an unmocked real request) — relevance unknown.

## Goals / Non-Goals

**Goals:** a probe-confirmed root cause; before/after failure rates under CI-like conditions; removal of the timing
dependency (not a longer deadline).

**Non-Goals:** raising timeouts, adding retries, changing the production lazy split, sweeping other suites.

## Decisions

**D1 — Probe before fix (systematic-debugging law).** Hypotheses, in order:
- H1: the test's wait ends only when the `echarts` node is in the DOM, and two costs stack inside the 1 s
  `findBy` window: (a) the cold first-load of the lazy `ChartPanel` module graph (transform + evaluation) under CPU
  contention, and (b) React 19.2.8's Suspense reveal throttle — once a fallback has been shown, react-dom delays the
  real content until >= 300 ms after the fallback appeared (`FALLBACK_THROTTLE_MS = 300`,
  `react-dom-client.development.js` ~27346, reveal via `setTimeout` ~16684-16700; consistent with the `listOnTimeout`
  frames). Primary measurement: render -> `echarts` node in the DOM ("render-to-visible"), split into render ->
  import resolved and import resolved -> visible, plus whether the fallback was shown at all. Probe via temporary,
  never-committed instrumentation, single file and full suite, `CI=true`, cold (fresh `--cacheDirectory` per run)
  vs warm, isolated vs contended (`--maxWorkers=3`, `nice -n 19`). Note on CI the shared on-disk cache may already
  hold ChartPanel's transform from an earlier file; each file still pays module-registry load cost. H1 is confirmed
  if render-to-visible approaches/exceeds 1000 ms in cold or contended runs (with the fallback shown), failures
  cluster there, and warm/uncontended runs stay well under.
- H2: test-order leakage (e.g. state from earlier tests, the unmocked XHR, pending timers). Probe: run the failing
  test in isolation (`-t`) vs whole file, and check whether the XHR errors originate in this file and whether
  removing them changes the outcome.
- H3: something else the probe surfaces. If H1/H2 are both refuted, report and escalate rather than patch.
- Note: echarts itself is mocked here, so the cold-start cost is transforming/evaluating ChartPanel's own helper
  modules — measure that cost, do not assume it is large.

**D2 — Fix shape if H1 is confirmed.** Make the chart module resolve before the timed wait instead of inside it:
add a bare side-effect `import "./ChartPanel";` in the test file (no unused binding) (so its transform/evaluation happens at file load, outside any
`findBy` window, and `React.lazy`'s `import()` then resolves from the module registry in a microtask), or
equivalently await the lazy module explicitly before rendering. Judge the fix by render-to-visible time, not import time:
state whether the chosen fix still shows the Suspense fallback (if it does, the 300 ms reveal throttle remains in the
window), and report the remaining margin under 1000 ms in the contended condition. Prefer a fix under which the
fallback is never shown; justify in a comment (no ticket-ref-only comments; explain the why). Rejected: raising the
`findBy` timeout (ticket forbids; it only moves the cliff), `jest.retryTimes` (forbidden), mocking `ChartRenderer`
away (would stop exercising the real chart path the test guards).

**D3 — Fix shape if H2 (or other) is confirmed.** Fix the leak at its source in the test (e.g. mock the unmocked
request, reset the leaking state). If the source is product code in PanelCard/Fullscreen and the fix would change
user-visible behaviour, ESCALATE and stop.

**D4 — Not reproducible.** If after a bounded effort (at least 30 cold-cache CI=true repeats of the file plus at least
5 full-suite contended runs) zero failures occur and the probe cannot push render-to-visible near 1 s: commit NO code
change; write `measurements.md` with the hypothesis, the measured render-to-visible distribution, and the CI-log analysis,
and return that as the outcome.

**D5 — Measurement protocol (before and after, identical).** Record in
`openspec/changes/fix-crossfilter-echarts-flake/measurements.md`: exact commands, environment (CI=true, workers,
cache state, nice), N, pass/fail counts, render-to-visible timings (with the import/reveal split and fallback-shown flag) before and after, and the worktree path each run executed
in. Use whichever condition reproduces the failure in the "before" measurement for the "after" measurement, same N.
If natural failures are too rare to measure, an artificial-contention or added-latency variant (e.g. a temporary
delay injected into the lazy loader in a scratch copy, never committed) is acceptable to demonstrate the fix removes
the dependency — label it as such.

## Risks / Trade-offs

- A static import in the test means the test no longer exercises the lazy boundary's fallback timing; acceptable —
  the test guards row narrowing, not code-splitting. The production split is unchanged.
- Other chart suites (e.g. `PanelCard.inspect.test.tsx`, `PanelCard.aggregateChart.test.tsx`) use the same
  `findByTestId("echarts")` pattern after a lazy load; if the probe shows them exposed, note them as a follow-up
  candidate rather than widening this change.

## Planner Notes

- Self-approved: test-only scope, `skip_specs: true` (no behaviour change).
- Resource caps are binding for every probe: jest <= 3 workers, `nice -n 19`, no more than 3-4 parallel processes;
  Bash calls use `timeout: 600000`. Never pkill/pgrep/killall.
