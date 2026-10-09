# HEL-1393: After the PipelineRunService split (#847): move preview code out, delete dead members, fix stale doc refs

## Description

origin_kind: followup
origin_ticket: HEL-1371

Blocked until HEL-1371's PR matto00/helio#847 merges (parked 2026-10-08 for an owner merge decision) -- RESOLVED:
#847 merged 2026-10-08. Items found during the behaviour-preserving split, deliberately not fixed there:

1. `PipelineRunService.scala` is still 634 lines. The preview code (`previewAtNode` etc.) stays there because
   `ExistenceNotLeakedRoutesSpec` pins exactly two `ServiceError.Forbidden(` producers in that file. Move preview into
   its own class and update the pin in the same change.
2. `resolvePrimaryDataSourceInternal` has no callers. Delete it.
3. The entry point's `log` val is now unused.
4. Stale doc refs after the move: `[[PipelineRunService.parseTruncationRecord]]`, `[[runPipeline]]`, "`onBlockedRun`'s
   persistence pattern below", "this file"/"this class" wording, and test comments at `ExistenceNotLeakedRoutesSpec:456`
   and `PipelineRunServiceSpec:1353`/`:2419`.
5. `backfillOutputNode`'s comment says `explicitRootId` is "Defaulted to `None`", but it has no default.
6. Odd indentation in `executeRunFailure` and `previewAtNode`, carried over from before the split.

## Acceptance criteria

- Items 2, 3 and 5-6 are behaviour-preserving (full suite unchanged).
- Item 1 keeps the existence-not-leaked guarantee (the pin is updated, not weakened; a red check that the pin still
  catches a third producer).
- Item 4: a grep shows no remaining stale refs.

## Premise validation (orchestrator, against origin/main ecaa1a53)

- File is now 652 lines (HEL-1384 #875 grew `recordUnrunnable`). Preview code at :261-534; Forbidden producers :199
  (`submit`) and :486 (`previewAtNode` AI-closure gate); pin at ExistenceNotLeakedRoutesSpec.scala:528.
- Item 3 is STALE: `log` is used at :234 (`recordUnrunnable`'s insertRun `recoverWith`, added by HEL-1384). Nothing to
  delete; out of scope.
- Item 5 applies in two places: PipelineRunService.scala:544 and PipelineRunBackfill.scala:68.
- `executeRunFailure` now lives in PipelineRunTerminalWrites.scala:44.
- HEL-1429 (queued next) also touches these files; do not absorb it.
