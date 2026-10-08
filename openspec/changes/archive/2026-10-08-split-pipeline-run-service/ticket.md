# HEL-1371: Split PipelineRunService.scala (~1751 lines) behaviour-preserving

## Description

`PipelineRunService.scala` is about 1751 lines (1770 at 4db9730fd), far over CONTRIBUTING's size threshold.
HEL-1366's lane suggested splitting it along this seam:

* `PipelineRunTerminalWrites`: the terminal persist-then-publish paths;
* `PipelineRunExecutor`: everything else.

Refactor discipline applies. Behaviour must not change, and the full `sbt testFull` suite plus
`PipelineRunServiceTerminalOrderingSpec` must pass unchanged. Any bug found along the way gets its own ticket
instead of being fixed in the refactor.

## Acceptance Criteria

- `PipelineRunService.scala` is split into cohesive files; the terminal persist-then-publish paths live in
  `PipelineRunTerminalWrites`, run execution in `PipelineRunExecutor`.
- Behaviour is unchanged. Preserved exactly: HEL-1366 (terminal SSE events published only after their durable
  writes), HEL-1370 (no `queued` publish for guard-rejected submits; `failed` published when the write-back Future
  fails), HEL-1374 (trailing defaulted `guardClock: Clock = SystemClock`, read only at `incrementRateIfUnderLimit`).
- The public API of `PipelineRunService` (constructor signature incl. defaults, public method signatures, companion
  members, `CachedRunStatus`, `TriggerSource`) stays source-compatible: no caller or spec changes.
- The full `sbt testFull` suite passes with no test logic changes (import-only edits allowed, none expected), and
  `PipelineRunServiceTerminalOrderingSpec` / `PipelineRunGuardIntegrationSpec` / `DatasetWriteAutoRunEndToEndSpec`
  pass unchanged.
- Reviewers can tell moves from edits: moved code is shown byte-identical (move-detection diff), and every non-move
  changed line is listed and justified.
- No inline FQNs (`check:scala-quality`, plus a by-eye check inside `s"${...}"`, HEL-1386).
- Any non-trivial bug found is reported as a follow-up, not fixed here.

## Driver context (overnight run)

Model split: orchestrator/evaluator/skeptic opus, executor/auditor sonnet. Merge under CON-231 interim rule:
origin/main ancestor of PR head and CI green on that exact head SHA before the auditor.
