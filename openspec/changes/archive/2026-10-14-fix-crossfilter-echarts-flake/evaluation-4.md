## Evaluation Report — Cycle 4 (evaluation-4.md; owner-approved extra cycle)

- Reviewed HEAD: 130183a09c259d38beefcbd8699ec89a3b496876 (base 609e62b6d, resolved live).
- Cycle-4 delta (commit 130183a09): `PanelCard.crossFilter.test.tsx` (comment rewritten, second
  `settleChartMount()` removed) and `measurements.md`.
- Whole-branch diff: the test file (+21/-8), `measurements.md`, `tasks.md`.

### Phase 1: Spec Review — PASS

- **Evaluation-3 CR1 (false comment) is fixed.** The Fullscreen comment (lines 408-411) now says three
  things, and each is verified:
  - `useOutputMeta` serves the grid card's result from `outputMetaCache`;
  - `getOutputById` is called once in the whole test;
  - the lazy `ChartPanel` is already loaded, so the Fullscreen chart mounts synchronously on the click.

  I re-checked this at this HEAD in a throwaway detached worktree. `getOutputByIdMock.mock.calls.length`
  is 1 at the Fullscreen query, and `within(fullscreenDialog).queryAllByTestId("echarts").length` is 1
  before any wait. I saw this in all 9 instrumented runs: clean, 1200 ms stall and 3000 ms stall.
- **Evaluation-3 CR2 is fixed.** The second, non-causal `await settleChartMount()` is gone, and the
  Fullscreen query is synchronous. `settleChartMount` now has exactly one caller (line 383, the grid). No
  leftover "SECOND ... fetch" or "HEL-572" text remains.
- **Scope: nothing else changed.** The cycle-4 delta touches only the Fullscreen comment and settle call in
  the test, plus `measurements.md` (the "Fix applied" paragraph corrected to match, and tables reflowed by
  prettier).
- **ACs remain met:**
  - mechanism probe-reproduced, with the CI stall source honestly labelled unconfirmed;
  - before/after recorded over N under the D5 artificial-stall allowance;
  - no timeout raised, no retry;
  - test-only change.
- **CONSTRAINTS:** C1 and C3 are honoured. C2: my probes ran sequentially with `nice -n 19` and
  `--maxWorkers=1`, and the gates used 2 workers.

### Phase 2: Code Review — PASS

**Gates.** I ran these fresh in WORKTREE_PATH with `nice -n 19`:
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- `npm run typecheck`: exit 0.
- `npm test` (HELIO_JEST_MAX_WORKERS=2): root 51 suites / 469 tests and frontend 596 suites / 7131 tests,
  all pass.
- `npm --prefix frontend run build`: exit 0.

**Independent stall check at this HEAD.** Throwaway worktree, since removed (`git worktree list` is clean).
Busy-wait in the `getOutputById` mock's resolution microtask, `CI=true nice -n 19 --maxWorkers=1`, runs one
at a time:

| Stall | Mode | Result |
|---|---|---|
| none | whole file | 2/2 pass |
| 1200 ms | alone | 3/3 pass |
| 1200 ms | whole file | 3/3 pass |
| 3000 ms | whole file | 1/1 pass |

The unmodified test fails under the same stall: 4/4 alone and 4/4 whole file, re-confirmed across cycles
1-3.

Settled findings from evaluation-3, unchanged by this delta:
- `act` genuinely bypasses React's 300 ms reveal throttle. React commits immediately when act's queue is
  active, and the grid settle measured 191-203 ms.
- The remaining `findByText` waits find their text synchronously, so they have no deadline exposure.

### Phase 3: UI Review — N/A

This is a test-only change. No UI-affecting product files changed.

### Overall: PASS

### Non-blocking Suggestions

- In `measurements.md` around line 28, prettier's reflow turned a continuation into a list item. The
  sentence used to read "render-to-visible is about max(import, 300 ms React `FALLBACK_THROTTLE_MS`) + ~10
  ms". It now ends at the parenthesis, followed by a bullet "- ~10 ms. The cold import ...". This
  garbles the "+ ~10 ms" claim. Rejoin it onto one line, for example "... `FALLBACK_THROTTLE_MS`) plus
  about 10 ms", at delivery. It is cosmetic and does not affect the fix or the evidence numbers.
- Follow-up candidates already recorded: `PanelCard.inspect.test.tsx` and `PanelCard.aggregateChart.test.tsx`
  use the same pattern.

Evidence note: the claims rest on instrumented call and node counts and on pass/fail outcomes, not on file
mtimes.
