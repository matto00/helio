# HEL-1797: Tidy after HEL-1720: dead removedPlacementCount, stale cascade comment, PatchSetUndoService size

## Description

origin_kind: followup
origin_ticket: HEL-1720

These are three small leftovers from HEL-1720 (merged as 917c89172).

## Acceptance Criteria

* `removedPlacementCount` is now always 0 after HEL-1720's refusal. Remove it, or show it still means something, and update its consumers and the response schema if it is on the wire.
* The comment at `PatchSetUndoLaneSpec.scala:84-86` still describes the old cascade. Correct it.
* `PatchSetUndoService.scala` is 402 lines, past CONTRIBUTING's split mark. Split it without changing behaviour: no assertion may change, and the full undo specs must pass before and after.

## Driver-added scope (behaviour-preserving tidy only)

Leftovers from the later undo lanes (HEL-1795/1796/1811 merged after this ticket was filed):

* HEL-1796: the ~290-character line in `PatchSetUndoService.restoreOne` (`dataSource` create arm); the mutable
  `ConcurrentHashMap` in `PatchSetApplyService.applyResolved`'s loop (replace only if behaviour-preserving and simpler).
* HEL-1811: the capture-failure warning in `PatchSetApplyService.captureCreatedChildren` says "steps and Outputs"
  though roots are captured too; misaligned arrows in `PatchSetUndoBoundPanels.doomedOutputIds`; the root-naming
  comment in `PatchSetUndoLaterChildren.describeRoot` claiming there is no sharing-aware read (verify data sources have
  no sharing, so owned == readable, and correct the comment).
* Missing guard tests (test-only; must pass on current code; each shown failable by a mutation): a form panel
  referencing an inline root (HEL-1796); excusing inline roots the pipeline create itself made (HEL-1811).

Any real bug found becomes a follow-up via triage, not a silent fix.
