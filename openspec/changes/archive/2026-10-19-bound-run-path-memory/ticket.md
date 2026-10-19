# HEL-1660: Pipeline runs: row fan-out from join, unpivot, splittext and chunkbytokencount can exceed the node row bound before any check, a possible backend OOM

## Description

Found by HEL-1630's design gate (draft preview, 2026-10-18). The owner ruled `row-budget` for the draft preview only: a
20,000-row `maxNodeRows`, checked up front by join and unpivot and while emitting by splittext and chunkbytokencount.

The same exposure exists for real pipeline runs and the saved-step preview, which are already in production. Join,
unpivot, chunkbytokencount, splittext and extractheadings can multiply rows well past any bound before a check runs,
and compute concat, the text-copying kinds (splittext, extractheadings, chunkbytokencount, convertformat) and pivot
column-name keys can grow text without bound. With Cloud Run's 768 MB heap, one crafted or accidental pipeline can
exhaust memory and crash an instance; with `--max-instances=2`, losing an instance matters. The catch-all `Throwable`
in `InProcessPipelineEngine.evalOneStep` (line 297 on main 069afd36d) turns an OutOfMemoryError into an ordinary step
error, so the instance carries on in a damaged state.

HEL-1630 merged as 069afd36d (PR #1069): its `RowBudget`, `StringBudget`/`CellWeight`, `LiveCellTally`, frame release
(`retainOnly`) and `PipelineExecutionContext` fields are on main, set only by the draft preview. This ticket reuses
them for every real run (manual, scheduled, hook, auto-run, backfill) and the saved preview.

## Owner rulings (escalation.answered 2026-10-19, answer_source=human)

1. Reuse HEL-1630's mechanism after it merges (now met).
2. Per-node row cap for runs and the saved preview: 100,000 rows.
3. Per-run memory budget: 25% of the 768 MB heap (about 192 MB), priced by text length like HEL-1630, with frame release
   so ordinary pipelines still fit.
4. Cap on any one text value a step creates in a run: 1,048,576 characters.
5. A run that hits a cap fails like any step error, naming the step, kind and limit, and writes no snapshot.
6. Saved pipelines over the new caps failing cleanly is accepted.
7. The catch becomes `NonFatal`, and the Dockerfile adds `-XX:+ExitOnOutOfMemoryError`.
8. (2026-10-19, second escalation) `nonfatal-plus-stackoverflow-arm`: a StackOverflowError stays a step error; and
   `accept-50kx6`: AC6 uses a 50,000 x 6 CSV.

## Acceptance Criteria

- AC1: Probe-confirmed exposure: on the real run path and the saved preview path, a heap/row probe in a bounded JVM
  (`-Xmx768m`) shows unbounded row growth or heap exhaustion per kind (join, unpivot, splittext, chunkbytokencount,
  extractheadings, compute concat, a text-copying fan-out, pivot column names) BEFORE the fix (red, recorded).
- AC2: Every real run and the saved preview applies a per-node row cap of 100,000: join and unpivot check up front;
  splittext, chunkbytokencount and extractheadings check while emitting; the engine backstop covers every other kind.
- AC3: Every real run and the saved preview applies a live-cell budget sized to 25% of a 768 MB heap, text priced by
  length, with frames released once no unevaluated child, lane dependent, Output node, trunk terminal or requested target
  still needs them.
- AC4: Every text-creating step in a run is bounded by a 1,048,576-character per-value cap and the per-node running text
  budget.
- AC5: Hitting any cap fails the run as an ordinary step error naming the step, its kind and the limit, worded as a
  pipeline run limit (not "draft preview"), and writes no node snapshot.
- AC6: An ordinary large pipeline still succeeds under the run budget, measured end to end. The pipeline is the widest
  CSV the run path accepts: 50,000 rows x 6 columns = 300,000 cells, the `CsvLimits` cell cap. It runs a 10-step compute
  chain with Outputs on a middle node and the terminal, and the run writes both Outputs' snapshots. Amended at design
  round 1, owner-accepted (`accept-50kx6`, 2026-10-19): the original "50,000 x 20" shape exceeds `CsvLimits.maxCells`.
- AC7: An OutOfMemoryError thrown during a step is no longer converted into a step error (`NonFatal`), and the Dockerfile
  JVM flags include `-XX:+ExitOnOutOfMemoryError`. A StackOverflowError (for example from a user regex) is still reported as a step error
  (owner ruling 8, `nonfatal-plus-stackoverflow-arm`).
- AC8: The draft preview's behaviour and messages are unchanged.
- AC9: A spec per kind plus a mutation per guard proves each bound (red first, then green).
