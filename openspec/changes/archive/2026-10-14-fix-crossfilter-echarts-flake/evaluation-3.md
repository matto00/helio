## Evaluation Report — Cycle 3 (evaluation-3.md)

- Reviewed HEAD: 3f94f4ec596c9b76f6b6a72d8e1a7966d8e2339b (base 609e62b6d, resolved live).
- Diff: `PanelCard.crossFilter.test.tsx` (+20/-6), `measurements.md`, `tasks.md`.

### Phase 1: Spec Review — PASS

- **ACs are met.**
  - The mechanism is probe-reproduced: a pre-mount stall gives the same failure DOM and line as CI.
  - The CI stall source is honestly labelled unconfirmed.
  - The fix is neither a raised timeout nor a retry.
  - Before/after numbers over N are recorded under the design.md D5 artificial-latency allowance.
  - The clean 30-run cold after-measurement is recorded.
  - The change is test-only.
- tasks.md 1.1-1.9 are ticked and match what was done.
- **No scope creep.** The other suites that share the pattern are listed as follow-ups, per design.md
  Risks.
- **CONSTRAINTS:**
  - C1 is honoured: no deadline at all remains in the chart-mount wait.
  - C2: my probes used `nice -n 19` and maxWorkers ≤ 3.
  - C3: render-to-visible is reported.

### Phase 2: Code Review — FAIL

**Gates.** I ran these fresh in WORKTREE_PATH and all pass:
- `npm run lint`: exit 0, zero warnings.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test` (HELIO_JEST_MAX_WORKERS=3, nice -n 19): root 51 suites / 469 tests and frontend 596 suites /
  7131 tests, all pass.
- `npm --prefix frontend run build`: exit 0.

**Independent verification.** I used a throwaway detached worktree at 3f94f4ec5, since removed (`git worktree
list` is clean). Every run was sequential with `CI=true nice -n 19 --maxWorkers=1`.
- **The stalled after-runs pass.** The stall is a busy-wait in the `getOutputById` mock's resolution
  microtask:
  - 1200 ms run alone: 3/3 pass.
  - 1200 ms whole file: 3/3 pass.
  - 3000 ms whole file: 2/2 pass.

  The unmodified test fails under the same stall. That was re-confirmed in cycles 1 and 2: alone 4/4 fail,
  whole file 4/4 fail.
- **Orchestrator point 2: act really does bypass the 300 ms reveal throttle.** It is not passing for an
  incidental reason.
  - In React 19.2.8's source, `react-dom-client.development.js` around line 16666 reads
    `if (null !== ReactSharedInternals.actQueue) commitRoot(...)` and skips the
    `FALLBACK_THROTTLE_MS` branch entirely.
  - React's ping/scheduling goes onto `actQueue` (around line 18921), which `act` drains.
  - Measured: the grid `settleChartMount()` took 191 and 203 ms (under 300 ms). After the settle there were
    0 `.suspense-fallback` nodes and 1 `echarts` node.
  - The ping happens inside the act scope because `settleChartMount()` is called synchronously right after
    render, before any microtask can resolve the lazy thenable.
- **Orchestrator point 3: the remaining `findByText` waits are unexposed.** "Showing rows for region: West"
  was already in the DOM synchronously before both `findByText` calls (instrumented: `true` for the grid and
  for Fullscreen). `waitFor` runs its callback synchronously before arming any timer, so these resolve on the
  first check with no deadline race.
- **Orchestrator point 1: the Fullscreen comment is false, and the Fullscreen settle waits on nothing
  causal.**
  - Instrumented call counts: `getOutputByIdMock.mock.calls.length` is 1 before the Fullscreen click and 1
    after `settleChartMount()`.
  - `within(fullscreenDialog).queryAllByTestId("echarts").length` is already 1 before the settle.
  - The reason is `useOutputMeta`, which reads through `outputMetaCache` (HEL-1392). The Fullscreen
    `OutputPanelContent` starts with the cached Output and issues no second request. The lazy `ChartPanel` is
    already resolved by the grid mount, so the Fullscreen chart commits synchronously inside the click.

Issues:
1. **False comment in a changed hunk.** `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx`
   lines 407-410 (HEAD numbering):

   > Fullscreen's OWN `OutputPanelContent` resolves its Output via a SECOND, independent `useOutputMeta`
   > fetch (the established HEL-572/HEL-579 "second fetch is fine" precedent) — `settleChartMount` waits out
   > that resolve rather than assuming it's already settled

   No second fetch occurs, and there is nothing for `settleChartMount` to wait out there. The executor's own
   measurements.md says "the Fullscreen mount does not call `getOutputById` again", so the comment
   contradicts the change's own evidence. CONTRIBUTING.md "Comments" treats a comment as something that
   must be kept in sync; this one was edited in this diff and left asserting a mechanism the probe refutes.
   It misleads the next reader about what guards this step.
2. **The second `await settleChartMount();` (line 411) is not causal.** It awaits already-resolved promises.
   It is harmless at runtime, but it presents itself as waiting on a fetch that does not exist. Either drop
   it and keep the synchronous `getByTestId`, or keep it with an honest rationale: a cheap guard in case the
   Fullscreen mount ever stops being synchronous, since `act` would flush a future async path.

### Phase 3: UI Review — N/A

This is a test-only change. No UI-affecting product files changed.

### Overall: FAIL

### Change Requests

1. In `PanelCard.crossFilter.test.tsx` lines 407-410, replace the Fullscreen comment with an accurate one.
   Fullscreen's `OutputPanelContent` gets the Output from the shared `outputMetaCache` (no second
   `getOutputById` request), and the lazy `ChartPanel` is already resolved by the grid mount, so the
   Fullscreen chart mounts synchronously with the click. Remove the "SECOND, independent `useOutputMeta`
   fetch" and "second fetch is fine" wording.
2. At line 411, either remove `await settleChartMount();` and keep the synchronous
   `within(fullscreenDialog).getByTestId("echarts")`, or keep it with a one-line accurate why. For example:
   it costs nothing and keeps the query deadline-free should the Fullscreen mount ever become async. Make the
   same edit to the measurements.md "Fix applied" paragraph so it does not claim both waits were causal.

### Critical Path (final cycle, CYCLE 3 = EXECUTION_CYCLES 3)

- **The only blocking item** is the false Fullscreen comment and its non-causal settle call (CR1/CR2). This
  is a comment or two-line edit with no behavioural risk.
- **Everything else is verified independently:**
  - the mechanism reproduction;
  - before/after under stall;
  - act's real bypass of the throttle (by source and by timing);
  - the unexposed `findByText` waits;
  - all gates green.
- **Recommendation for the human:** approve one small follow-up edit for CR1/CR2, either by the executor
  outside the cycle budget or at delivery, then merge. The fix itself is sound. Do not merge with the false
  comment as-is.

### Non-blocking Suggestions

- `settleChartMount` reads `getOutputByIdMock.mock.results`. That couples it to the mock's internals, which
  is fine here. A brief note that it must stay in the describe whose mock it reads would help if it is ever
  lifted into a shared helper.
- Follow-up candidates already listed: `PanelCard.inspect.test.tsx` and `PanelCard.aggregateChart.test.tsx`.

Evidence note: the claims rest on instrumented call counts, DOM node counts, measured durations and pass/fail
outcomes. None rest on file mtimes. The throwaway worktree was removed after use.
