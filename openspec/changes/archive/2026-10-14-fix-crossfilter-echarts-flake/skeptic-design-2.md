## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: 609e62b6d917243355a179fa8a26318c04898c27. The planning artifacts are untracked files in the change dir.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/fix-crossfilter-echarts-flake/HEL-1596`.
- **Round-1 CR1 landed:** the "retry pass" premise is gone from `ticket.md`, from `design.md` Context (it now says "one failure
  per run in two independent runs ... each a single jest invocation"), from D1, which no longer has the phantom-retry Note,
  and from task 1.1 ("single invocation, no retry — verified"). The round-1 non-blocking notes were also folded in: the bare
  `import "./ChartPanel";` form is in D2, D1's last bullet notes that echarts is mocked, and D4's repeat count is now bounded.
- **Test-file facts hold:** line 369 is `(await screen.findAllByTestId("echarts"))[0]`. The test starts at line 350. The only
  `kind: "chart"` Output is in the last describe. `jest.mock` for `echarts-for-react/esm/core` and `./echartsCore` is at the
  top of the file. The ts-jest preset is used, `jest.setup.ts` has no `asyncUtilTimeout` override, and `jest.resetModules` is
  absent from setup. So a top-level side-effect import would share the per-file registry that `ChartRenderer`'s `import()`
  resolves against.
- **ChartRenderer.tsx:19** is `lazy(() => import("../ChartPanel").then(...))`. Confirmed.
- **React version:** `node -p "require('react/package.json').version"` printed `19.2.8`.
- **React 19.2 fallback-reveal throttle exists in the installed build:**
  `node_modules/react-dom/cjs/react-dom-client.development.js:27346` has `FALLBACK_THROTTLE_MS = 300`. Lines 16684-16700 show
  that a retry-lane render (`(lanes & 62914560) === lanes`) arriving within 300 ms of the last fallback commit
  (`globalMostRecentFallbackTime`, set at line 14937) is not committed. React instead calls
  `scheduleTimeout(commitRootWhenReady...)`, a `setTimeout`. Lines 18605-18609 apply the same throttle on ping. So once the
  `suspense-fallback--panel` skeleton has committed, which both CI failure DOMs show, the chart cannot appear until at least
  about 300 ms after that commit, however fast the lazy promise resolves. That timer also matches the ticket's
  `listOnTimeout` frames.
- **Scope, ACs and constraints:** the ACs are covered. Probe first is D1. Before/after over the same N is D5. No timeout or retry
  is C1 and D2's "Rejected". The not-reproducible branch is D4 and task 1.6, and product-bug escalation is D3. The change is
  test-only, `skip_specs: true` is justified, and no contract delta is needed. The resource caps are restated in C2 and the
  Planner Notes.

### Verdict: REFUTE

### Change Requests

1. **The H1 probe and D2's success criterion measure the wrong quantity.** D1/H1 measures "the time from render to the lazy
   promise resolving" and calls H1 confirmed when that time "approaches/exceeds 1000 ms". D2 picks the fix shape that "brings
   the resolve time to near zero". The `findAllByTestId` window does not end when the lazy promise resolves. It ends when the
   `echarts` node is committed. In React 19.2.8 (above), a Suspense boundary whose fallback has already committed reveals its
   content through a throttled `setTimeout`, at least `FALLBACK_THROTTLE_MS` = 300 ms after the fallback commit. Under CPU
   contention that timer slips too. This causes two concrete failure modes:
   (a) H1 can be wrongly refuted. For example, a 600 ms cold resolve plus a 300 ms or longer throttled reveal plus render
   overruns 1000 ms, but 600 ms does not look like "approaching 1000 ms".
   (b) The fix can be wrongly accepted. A static import can cut the resolve to near zero while the fallback still commits and
   the 300 ms or longer reveal timer is still on the critical path.
   Required revisions:
   - In `design.md` D1/H1 and task 1.4, instrument and record **render → `echarts` node in the DOM** as the primary
     metric, broken down into (i) lazy `import()` resolve time and (ii) resolve → commit, which includes the React fallback
     throttle. Also record whether the `suspense-fallback--panel` fallback committed at all.
   - Restate the H1-confirmed criterion in terms of render-to-visible time against the 1000 ms window.
   - In D2, make the acceptance signal render-to-visible time, not resolve time. Require the probe to show whether the chosen
     fix (side-effect import, or awaiting the module before render) still commits the fallback and so still pays the throttle.
     If it does, say so explicitly, and state the remaining margin under the contended condition.
   - In D5, add render-to-visible timings (not only "lazy-resolve timings") to the before/after record.

### Non-blocking notes

- The "cold on a fresh runner" framing in the Context needs a caveat. CI's transform cache lives in a single on-disk
  directory shared by all 3 workers. By the time this file runs, another chart-rendering test file may already have
  transformed `ChartPanel`'s graph, so in CI the transform may well be warm. The per-file module-registry *evaluation* cost
  is always paid, though. The fresh-`--cacheDirectory` probe is still useful as an upper bound, but the executor should
  not assume CI was transform-cold for this file. If possible, check which suites preceded it on that worker in the CI log.
- D4's 30 cold repeats plus 5 contended full-suite runs is a reasonable bound. Budget the wall-clock time, and keep every
  run at `--maxWorkers<=3` with `nice -n 19`.
