## Why

`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` is 2571 lines at origin/main 1b765f59d,
about 10x CONTRIBUTING.md's ~250-line soft budget. One class mixes pipeline create (root preflight, inline sources,
the single-transaction create), root add/remove, analyze/concise analyze, node capabilities and lane tree, proposal
analyze, and step create/update/delete/reorder/duplicate. Every change to any of these lands in the same file.

## What Changes

- Move the class's members into concern-focused `private[pipelines] final class` collaborators in the same package,
  bodies byte-identical: shared support, create writes, create transaction, root writes, analyze reads, node
  reads, proposal analyze, step create, step writes (see design.md D2).
- `PipelineService` keeps its name, package, constructor, every public method signature (moved ones become one-line
  delegations), its companion object, `PipelineCreateValidationFailure`, and `requireEditorAccess` (the file's pinned
  `ServiceError.Forbidden(` producer).
- Moved code logs through the `classOf[PipelineService]` logger, so log names are unchanged.
- No behaviour change, no wire change, no test-source change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Pure structural refactor; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- Splitting `PatchSetApplyResolvers.scala` (853 lines): a separate ticket, filed by this run.
- Moving the companion object's helpers, renaming anything public, deleting dead code, fixing stale doc links,
  editing tests (beyond imports, if any are forced), or fixing any defect found (each becomes a follow-up).

## Impact

`backend/src/main/scala/com/helio/services/pipelines/` only, plus the package README's file list. No API, schema,
migration, or frontend change.
