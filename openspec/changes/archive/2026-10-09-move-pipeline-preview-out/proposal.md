## Why

HEL-1371 (#847) split `PipelineRunService.scala` behaviour-preservingly but deliberately left the preview code in the
entry point (a test pin required both `ServiceError.Forbidden(` producers to stay there), plus a dead private member,
stale doc references and odd indentation. The entry point is 652 lines, over the 400-line backend file-size budget.

## What Changes

- Move `previewStep`, `previewOutputs` and `previewAtNode` into a new `private[pipelines]` class
  `PipelineRunPreview` (same package). `PipelineRunService.previewStep/previewOutputs` keep their exact signatures as
  one-line delegations. Update `ExistenceNotLeakedRoutesSpec`'s Forbidden-producer pin to
  `PipelineRunService.scala -> 1`, `PipelineRunPreview.scala -> 1` (same total, same exact-match guard).
- Delete the caller-less private `PipelineRunSupport.resolvePrimaryDataSourceInternal`.
- Fix stale doc refs and "this file/class" wording made false by #847 and by this move; replace test comments that
  cite `PipelineRunService.scala:<line>` with symbol references.
- Correct `backfillOutputNode`'s "Defaulted to `None`" comment (two copies).
- Re-indent `executeRunFailure`'s body and the two under-indented blocks in `previewAtNode` (whitespace only).
- Ticket item 3 (unused `log`) is dropped: the val became used by HEL-1384.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Pure structural refactor; no behaviour or API change (`skip_specs: true`).

## Non-goals

- No behaviour change, and no bug fix: any defect found becomes a follow-up ticket.
- HEL-1429 (FireTimeRunConfigGateSpec relabel, `PipelineSchedulerService.fire()` `recover` comment, a further split
  of the run/scheduler services) is not absorbed.
- No edit to archived OpenSpec changes or to migration SQL comments (immutable history).

## Impact

`backend/src/main/scala/com/helio/services/pipelines/` (PipelineRunService, new PipelineRunPreview,
PipelineRunSupport, PipelineRunTerminalWrites, PipelineRunBackfill, README.md, possibly other files' doc comments),
`ExistenceNotLeakedRoutesSpec` (pin map, run-status row site), `PipelineRunServiceSpec` (comments only).
No API, schema, migration or frontend change.
