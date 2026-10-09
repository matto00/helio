# HEL-1409: Patch-set rollback (RestorePriorStored) can reintroduce V94 dead Output config keys after V117

## Description

origin_kind: followup
origin_ticket: HEL-1387

HEL-1387 adds migration V117, which renames or drops the V94/HEL-877 dead Output config keys (`metricLabel`,
`chartAnnotation`, `timelineOptions`, ...).

The problem: `PatchSetUndoService` restores a journaled config with `OutputConfigWritePolicy.RestorePriorStored`. If a
patch set was journaled before V117 and is rolled back after it, the restore can bring the dead keys back and drop the
renamed live key (`label`, `annotation`, `sort`, ...). Those dead keys are still tolerated, both on read and by
HEL-1313, so nothing breaks. The settings just stop rendering again.

HEL-1387's design deliberately did not rewrite the journals, because they are point-in-time records.

Options:

* (a) Normalise the dead keys at RestorePriorStored time, using the same mapping as V117 (see its header).
* (b) Accept the gap. Re-running V117's DO block would repair the affected rows, since it is idempotent.

Expected impact is low: it needs a pre-V117 patch set that touched one of these Outputs to be rolled back later.

## Acceptance Criteria (derived; the ticket states options, the queue selected option (a))

- A patch-set undo/rollback that restores a journaled Output config holding V94/HEL-877 dead keys writes the config
  that V117 would have produced from it (renames to the live key where V117 renames, drops where V117 drops; a non-null
  live key is never overwritten) — never the dead keys.
- The restore-time mapping is the SAME mapping as V117's; a test fails if the Scala mapping and V117's SQL drift.
- Journals are not rewritten (they stay point-in-time records). No new migration.
- A red test reproduces the gap on origin/main before the fix (journal containing a pre-V117 config).

## Premise validation (Setup step 2, verdict: minor-staleness)

The ticket names the wrong site. `PatchSetUndoService` has no `output` `update` undo path (Phase 1 refuses it, 409
"no undo path"); `RestorePriorStored` for Outputs is used only by `PatchSetApplyRollback` (same-request mid-apply
compensation), whose prior config is read live at apply time (post-V117). The real journal-restore site is
`PatchSetUndoService.restorePipelineStepDelete` → `restoreBoundOutputs` → `outputRepo.insertInternal(config = journaled
config)`, which writes the journaled config raw. Fix covers that site, and also normalises under `RestorePriorStored`
so the ticket's literally-named path is closed too.
