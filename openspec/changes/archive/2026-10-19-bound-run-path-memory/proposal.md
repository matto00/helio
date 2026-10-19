## Why

Real pipeline runs and the saved preview carry none of HEL-1630's memory bounds, so one pipeline that fans out rows
(join, unpivot, splittext, chunkbytokencount, extractheadings) or grows text (compute concat, text copies, pivot
column names) can exhaust the 768 MB production heap and crash an instance, and the catch-all `Throwable` in the
engine hides the OutOfMemoryError as a step error. HEL-1630 merged its mechanism for the draft preview; the owner ruled
that runs reuse it now.

## What Changes

- Every real run (manual, scheduled, hook, auto-run, dataset-write auto-run, backfill) and the saved preview run under
  run limits: 100,000 rows per node, a live-cell budget of 25% of the heap with text priced by length, frame release,
  and a 1,048,576-character cap per created text value (owner rulings 2-4).
- A run over a limit fails as an ordinary step error naming the step, kind and the pipeline run limit; no snapshot is
  written (rulings 5-6). **BEHAVIOUR CHANGE:** saved pipelines past these limits, which today risk an OOM, now fail
  cleanly.
- The limit messages take a label, so the draft preview keeps its wording and runs say "pipeline run limit".
- `evalOneStep` converts only `NonFatal` throwables and StackOverflowError into step errors, and the container JVM exits on
  OutOfMemoryError (rulings 7-8).

## Capabilities

### New Capabilities
- `pipeline-run-memory-bounds`: the row, live-cell and text limits every real run and the saved preview enforce, how a
  breach is reported, and fatal-error handling.

### Modified Capabilities
(none: the existing run-execution requirements are unchanged; a breach is an ordinary step failure)

## Impact

- Backend: `InProcessPipelineEngine`, `InProcessExecutionBackend`, `PipelineExecutionBackend`, `PipelineRunExecutor`,
  `PipelineRunPreview`, `PipelineRunBackfill`, `SparkJobSubmitter` (trait signature only; never wired), `RowBudget`, `StringBudget`, a new run-limits object; tests.
- `Dockerfile` JVM flags. No schema, API shape, migration or frontend change.

## Non-goals

- A global (cross-run, cross-owner) memory admission limit; the budget is per run.
- Catastrophic-backtracking regexes (HEL-1676) and draft-preview loose ends (HEL-1677).
- Changing the run walk order, the HEL-505 run guard, or tier-specific limits.
