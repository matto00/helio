## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD: 609e62b6d917243355a179fa8a26318c04898c27. The planning artifacts are untracked files in the change dir.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/fix-crossfilter-echarts-flake/HEL-1596`.
- **Round-1 CR1 (phantom "retry pass") is still resolved.** `ticket.md` observations, `design.md` Context ("one failure per run
  in two independent runs ... each a single jest invocation") and task 1.1 ("single invocation, no retry — verified") match
  what round 1 established from the CI logs.
- **Round-2 CR1 (the metric being measured) landed in every place it was required:**
  - D1/H1 now gives "render -> `echarts` node in the DOM" as the primary measurement. It is split into render -> import
    resolved and import resolved -> visible, and it records whether the fallback was shown at all.
  - The H1-confirmed criterion is now stated as render-to-visible time against the 1000 ms window.
  - D2 judges the fix by render-to-visible time. It requires saying whether the fix still shows the fallback, and if it does,
    that the 300 ms throttle is still in the window. It also requires the remaining margin under contention.
  - D5 records render-to-visible timings, with the split and the fallback flag, both before and after.
  - Task 1.4 and the new constraint C3 (also present in `workflow-state.md` CONSTRAINTS) carry the same metric.
  - The round-2 non-blocking caveat about cold cache is folded into H1: the shared on-disk cache may already be warm in CI, but
    the module-registry load cost is always paid.
- **Re-checked ground truth independently:**
  - `ChartRenderer.tsx:19` is the `lazy(() => import("../ChartPanel")...)` split.
  - In `PanelCard.crossFilter.test.tsx`, line 369 is the grid `findAllByTestId("echarts")`, and the test starts at line 350.
  - The only `kind:` values in the file are `table` (78), `metric` (207) and `chart` (327, inside the last describe).
  - `react-dom-client.development.js:27346` has `FALLBACK_THROTTLE_MS = 300`.
  - `jest.config.cjs` is ts-jest, with no `retryTimes`, and spreads `localJestCaps` (which is empty under CI).
- **AC coverage:**
  - Probe-confirmed root cause before any fix: D1 and C1.
  - Before/after failure rate over the same N under CI-like conditions: D5 and tasks 1.2, 1.3 and 1.8.
  - No timeout and no retry: C1 and D2's "Rejected" list.
  - Not-reproducible branch: D4 (bounded at 30 cold repeats plus 5 contended full-suite runs, no code change, `measurements.md`
    instead).
  - Product-bug escalation: D3.
  - Scope stays test-only and `skip_specs: true` is justified. No contract delta is needed.
  - Resource caps are restated in C2 and the Planner Notes.
- **Placeholders/contradictions:** none found. The proposal, design and tasks agree on the file in scope, the fix shapes and the
  measurement protocol.

### Verdict: CONFIRM

### Non-blocking notes

- **D2's "prefer a fix under which the fallback is never shown" probably cannot be met by either D2 shape as written.**
  `React.lazy` initializes its payload only on first render. That render calls the factory, and the factory returns a fresh
  `import()` promise. Under ts-jest's CommonJS transform this is roughly `Promise.resolve().then(() => require(...))`, so the
  promise is pending even when the module is already in the registry. Neither a side-effect `import "./ChartPanel"` nor
  awaiting the module before render changes the lazy object's status. So the first render most likely still suspends and
  commits the fallback, which leaves the 300 ms reveal throttle on the critical path.
  D2 already requires the executor to measure and report this, along with the remaining margin, so it is not a blocker. But
  the executor should expect it. If the fallback does still commit, they should report the post-fix render-to-visible as
  about 300 ms plus render time under contention, rather than claiming the timing dependency is fully gone. One option for a
  shape with no fallback: warm the *lazy* component itself in a `beforeAll`, by rendering a `ChartRenderer` once and waiting
  for it, so the lazy payload is already resolved by the time the real test renders. This is a judgment call for the
  executor, and it must be probe-verified like everything else.
- The pre-fix failure condition is roughly max(import, 300 ms) + commit/render ≥ 1000 ms. When writing up H1, the executor
  should keep in mind that the throttle and a slow import overlap rather than add together.
