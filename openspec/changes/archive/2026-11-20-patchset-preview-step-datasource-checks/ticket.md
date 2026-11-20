# HEL-1722: Patch-set preview: dry-run step add/update and data-source edit checks before apply

## Description

HEL-1638 makes propose-time validation run apply's own pre-write checks, writing nothing, for pipeline, combined and
dashboard proposals, patch-set panel create and update, and patch-set `pipeline` create edits.

It deliberately left two patch-set edit kinds for later. For these, preview still runs fewer checks than apply, so a
patch set can look valid in review and then fail on apply.

- **Step add (`pipelineStep` create).** `PipelineService.addStep` (`PipelineStepCreate.scala`) runs checks that the
  resolver (`PatchSetPipelineStepResolvers`) does not: placement (`StepPlacement`), lane and descendant cycle checks,
  reference and ownership checks, editor access. The resolver runs only `rawConfigProblem` and second-source ownership.
- **Step update.** The checks in `PipelineStepWrites.updateStep` are not yet enumerated.
- **Data-source create and update.** `DataSourceService.createStatic` validates rows, column types, defaults and the
  row cap. `DataSourceService.update` rejects an empty name. Preview's `resolveDataSourceCreate` only checks
  `type == dataset`.
- **Patch-set `pipeline` create with roots but no steps or Outputs.** `PatchSetPipelineResolvers.resolvePipelineCreate`
  skips the root dry run when preflight returns early. In that case an inline static, sql or rest root's create checks
  (`validateStatic`, `validateSqlCreate`, `validateRestCreate`) do not run at preview, and apply rejects the root at
  create time. Not a regression; found by HEL-1638's evaluator in cycle 1.

Desired: the same treatment HEL-1638 gives the other paths. Extract these checks into functions that the service write
calls and that `PatchSetApplyResolvers.resolveAll` also calls, so preview and apply share them. Add a parity test.

origin_kind: followup
origin_ticket: HEL-1638

## Acceptance Criteria

1. Patch-set preview of a `pipelineStep` create rejects, with the service's message (prefixed `edit N: `), every
   request `PipelineService.addStep` would reject before its first write, through a check function `addStep` itself
   calls (placement, lane/descendant cycle, reference/ownership incl. upsert target, editor access, type, config).
2. Same for a `pipelineStep` update against `PipelineService.updateStep`; the update checks are enumerated in the
   change's inventory, each classified dry-run (shared function) or apply-only with a reason.
3. Same for `dataSource` create against `DataSourceService.createStatic` (`validateStatic`, real row cap) and
   `dataSource` update against `DataSourceService.update` (empty name).
4. A patch-set `pipeline` create with roots but no steps or Outputs runs its inline roots' create checks at preview.
5. A parity spec shows each of the four gaps red on main (committed red run), green after; a mutation removing a
   shared check's call from the preview side turns it red. Apply behaviour is unchanged apart from rejecting the
   same inputs earlier, before any write.

## Driver context (claims, verified at planning)

- Backend only; no migration (Flyway max V146; ask before taking V147).
- In-flight sibling HEL-1720 edits patch-set UNDO (PatchSetUndoService, PatchSetUndoConflictCheck). Do not edit those
  files or their specs.
- No live model call; any lane backend runs with ANTHROPIC_API_KEY exported empty.
