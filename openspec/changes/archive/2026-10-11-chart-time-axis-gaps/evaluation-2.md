## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: f8392cf14e284fa82efe79ced5b1084f79c6c5c0. Diff base resolved live: 3eb0cc893. Cycle delta reviewed: aa8b4f4ea..f8392cf14.
Fresh evidence: `.concertino/runs/HEL-1305/evidence/eval-2/`.

### Phase 1: Spec Review — PASS

evaluation-1's change request is resolved: task 3.9 / D11d are now implemented as specified.
- `buildChartOption.unchangedPath.test.ts` deep-compares the whole built option (`toEqual`) against `chartUnchangedPath.main.snapshot.json`. Formatter functions are compared as `expect.any(Function)` (D13f).
- There are 32 cases in `unchangedPathCases.ts`, run as 105 tests. They cover:
  - line, bar, scatter (with size and colour), pie, heatmap and histogram;
  - aggregate bar, line and pie;
  - stacked, normalized and horizontal bars;
  - overlay, reference marks, and both together;
  - `fieldTypes` absent, `null`, a string-typed x, and timestamp on a non-x field;
  - timestamp-x cases for pie, heatmap, histogram, horizontal bar, horizontal stacked bar and aggregate pie (ruling 5).
- The only allowed exception is owner ruling 2, the multi-series gap. The test asserts the frozen cell is `0` before setting it to `null` (`buildChartOption.unchangedPath.test.ts:32-34`), so the exception is explicit, not a blanket allowance.
- CONSTRAINTS C1-C3 are still honored. The delta adds no `eslint-disable`, `color-mix` or `@ts-ignore`.

### Phase 2: Code Review — PASS

**The snapshot comes from main, not from HEAD** (orchestrator's key question). I checked it independently with `eval-2/snapshot-provenance.test.ts.txt`, which reads `eval-2/snapshot-provenance-result.txt`. For every one of the 32 cases, it builds the option from main's own source (a `git archive` of frontend/src at 3eb0cc893) and from HEAD's source, then compares each against the checked-in JSON:
- All 32 cases: **main output == snapshot**.
- 30 cases: HEAD output == snapshot.
- The 2 gap cases ("line/bar multi with a gap"): **HEAD output != snapshot**, because HEAD plots `null` where the snapshot has main's `0`.

A capture of HEAD would have `null` in those cells. The snapshot holds main's `0`, so it was generated from the pre-change tree.

**Mutation proof** (`HEL-1305-mutation-unchangedPath-guard.txt`):
- Pie-value mutation: 5 tests red.
- Gap set back to 0: 8 red. This shows the ruling-2 exception is not vacuous.
- xAxis-merge mutation: 94 red.
- `valueFormatter` mutation: 104 red.

The first M1 and M4 attempts reported "0 total" because they failed TS compile, and the re-runs with diagnostics off are the valid ones. The file says so plainly.

Checks on individual points:
- The case keys are real option keys: `line.areaFill`, `histogram.binCount` and `bar.stacking`/`orientation` exist in `types/panel.ts`.
- Non-blocking notes from evaluation-1 that were folded in:
  - the `\u0000` check is now the named constant `ECHARTS_AUTO_SERIES_NAME_MARK`, with a comment (`timeAxisOption.ts:11-12`, behaviour-identical);
  - the reference-marks block is relabelled as a behaviour test (`buildChartOption.timeAxis.overlay.test.ts:99`).
- `unchangedPathCases.ts` is 158 lines and the test is 54 lines, both within budget.

**Gates, fresh, run in WORKTREE_PATH:**
- lint, format:check and typecheck: exit 0.
- `npm test`: exit 0. Frontend: 549 suites, 6070 tests (5965 + 105 new). Root: 453 tests.
- `npm --prefix frontend run build`: exit 0.
- Backend: the cycle delta touches no `backend/**` file. My cycle-1 `sbt testFull` run (7133 passed, 0 failed, `eval-1/sbt-testFull.log`) covers the same backend tree, so I did not re-run it.

### Phase 3: UI Review — PASS

Cycle 2 makes no runtime UI change beyond a constant extraction. I re-checked fresh anyway:
- I started fresh servers via `start-servers.sh` on 6737/9644 and confirmed both processes run from this worktree.
- The HEL-1305 e2e spec passed 4/4 (light/dark at 1440/375): time axes, proportional spacing, gap nulls, and the gap tooltip `2026-09-03 A: 16 B: —`.
- The spec's throwaway users are `@example.test`. It made 20 exact-id deletes, and its teardown reported `deleted 4 recorded throwaway user(s)`.
- The servers were stopped by exact PID afterwards.
- I did not use the MCP browser this cycle.

Cycle-1 running-app findings stand: no console errors, cross-filter works, and breakpoints are intact.

### Overall: PASS

### Non-blocking Suggestions
- These carry over from evaluation-1 for the PR body or a follow-up. Neither blocks:
  - `ChartTimestampParsingParitySpec` asserts `None` for the `MM/dd/yyyy` cases, slightly beyond design D3.
  - A single-series bar over raw rows where two rows share an instant now overlaps the bars on a time axis.
