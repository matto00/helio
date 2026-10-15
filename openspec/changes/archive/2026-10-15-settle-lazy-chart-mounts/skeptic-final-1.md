## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `46fe11bb11181161e3a0d334aecedd9715573f1b` against the live-resolved base `10d8626cc3816fd4e8ec643c2c1ebace5d268ead`
(`scripts/concertino/resolve-review-base.sh`, exit 0). Worktree `/home/matt/Development/helio/.claude/worktrees/task/settle-lazy-chart-mounts/HEL-1599`.
Every jest run below: cwd `<worktree>/frontend`, `CI=true nice -n 19`, `--maxWorkers=1` (single file) or `3` (file list), cold `--cacheDirectory` in the
session scratchpad, sequential. Scratch edits restored with `git checkout --`; afterwards `git status --short` shows only the untracked
`evaluation-2.md` and `git grep`/`grep -rn 'SCRATCH STALL' src` returns 0 hits.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/settle-lazy-chart-mounts/HEL-1599`.
- **Diff scope:** 15 frontend test files + new `frontend/src/test/settleChartMount.ts` + change artifacts. No production code touched (test-only, no UI
  review needed).
- **AC2 (shared helper):** `frontend/src/test/settleChartMount.ts` awaits every recorded result of the passed mocks / plain promises plus
  `import("../features/panels/ui/ChartPanel")` inside `act`; the local helper in `PanelCard.crossFilter.test.tsx` was removed in favour of it.
  Every converted site is `await settleChartMount(<sources>)` followed by synchronous `getBy*` (read the full `+/-` diff).
- **AC5 (no timeout / retry):** `git diff base...HEAD -- frontend/src | grep '^+.*(timeout|retry|retries|setTimeout)'` → only a doc-comment line
  in the helper; no timeout option, no retry wrapper added.
- **AC4 (sweep), independently:** `grep -rn 'findByTestId("echarts")\|findAllByTestId("echarts")\|findByTestId("chart-panel")' src` → 0 hits remain.
  `grep -rn -A6 'waitFor(' src --include=*.test.tsx | grep 'echarts\|chart-panel'` → only `PanelContent.chartTruncation.test.tsx:177`, a synchronous
  `getByTestId` after the same test already mounted the lazy module (not a wait) — matches measurements.md. `ChartPanel.tsx` renders no testid/role
  of its own, and the only `lazy(` over ChartRenderer/ChartPanel is `renderers/ChartRenderer.tsx:19`. The remaining chart-word `findBy*` files I
  checked (`OutputEditorSheet.{heatmapHistogram,scatterPickers,labels,referenceMarks}`, `PipelineDetailPage.outputSwap`) do not mock echarts and wait on
  form controls / editor text, consistent with the "Left" table. The inventory (converted vs left, with reasons) is in measurements.md.
- **AC1/AC3 red-before / green-after, reproduced by me (two independent pairs):**
  1. Exact HEL-1596 method on `PanelCard.inspect.test.tsx`: `getOutputByIdMock.mockResolvedValue(...)` replaced (scratch) by a `mockImplementation`
     whose resolution microtask busy-waits 1200 ms; `-t "shows an Inspect item"`, N=3.
     - base-version file (`git show 10d8626cc:...`): rc=1 x3, `Tests: 1 failed, 4 skipped, 5 total`, `Unable to find an element by: [data-testid="echarts"]` in every run.
     - HEAD file: rc=0 x3, `Tests: 4 skipped, 1 passed, 5 total`.
  2. Symmetric injection on a no-argument (`settleChartMount()`, lazy-module-only) site, `ChartRenderer.timeNote.test.tsx` "states how many rows a time
     axis left out": a `queueMicrotask` 1200 ms busy-wait inserted immediately before the wait line, with a fired marker file; N=3.
     - base-version file: rc=1 x3, `1 failed, 5 skipped, 6 total`, echarts-not-found x1 each run, fired=1 each run.
     - HEAD file: rc=0 x3, `5 skipped, 1 passed, 6 total`, fired=1 each run (stall really landed; green is not vacuous).
  This covers both helper shapes (mock-gated and module-only) and confirms the executor's finding that the direct-render ChartRenderer files are
  exposed (contradicting design.md D1's "absorbed" prediction, which measurements.md discloses).
- **Clean run, all 15 converted files:** `npx jest --maxWorkers=3 <15 files>` → `Test Suites: 15 passed, 15 total`, `Tests: 98 passed, 98 total`, rc=0.
- **Gates for changed areas:** `npm run typecheck` (tsc --noEmit) exit 0 with no output; `npx eslint --max-warnings 0` on the helper + 15 files exit 0.
  Full-suite / build / format results are relied on from evaluation-2.md's pasted output (612/612 suites, 7268 tests, exit 0) — unambiguous and
  consistent with my partial runs.
- **Debugging law:** root cause (1 s RTL `findBy` deadline racing a pre-mount main-thread stall) is the HEL-1596 probe-confirmed cause, re-confirmed per
  file by the stall probes; the regression proof is red under the stall before and green after, which I reproduced.
- **Regression-guard strength:** the sync `getBy*` still asserts the real chart path (evaluator's mutation: deleting a settle line turns the file red).
- No mtime-ordering claims were relied on.

### Verdict: CONFIRM

### Non-blocking notes

- `settleChartMount.ts` hard-codes the `ChartPanel` module path that `ChartRenderer.tsx:19` lazy-loads. If that import target ever moves, the helper
  would await the wrong module; tests would then fail loud (synchronous `getBy*`), not pass falsely, so this is maintainability only.
- `PanelContent.chartTruncation.test.tsx:177`'s negative `not.toContain("vs 7d")` after `waitFor(fetchHistory calls)` may be vacuous if history has not
  resolved yet; pre-existing and outside this ticket.
- The non-chart `findByText`/`findByRole` waits that race the same deadline (listed under "Left") are a reasonable follow-up ticket.
