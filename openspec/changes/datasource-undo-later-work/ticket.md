# HEL-1796: Undoing a dataSource create: check whether it deletes later work (pipelines, rows, panels)

## Description

origin_kind: followup
origin_ticket: HEL-1720

HEL-1720 (merged as 917c89172) guarded the undo of `output`, `pipelineStep`, `pipeline` and `dashboard` creates against deleting work added after the apply. The `dataSource` create undo was outside that ruling and no one has checked it.

**Question:** when a patch set creates a data source and is later undone, what does the delete take with it? Possibilities:

* a pipeline that uses the source as a root or secondary, created later, perhaps by another user;
* rows appended later, including form submits by editors (HEL-1784);
* panels bound downstream of it.

## Acceptance Criteria

* Premise check: list what the delete actually removes or breaks, through FK cascades and through code. Record the evidence.
* If anything created after the apply is lost, first write a failing test on `helio_app_test`. Then apply HEL-1720's rule: refuse with a 409, all-or-nothing, naming only what the undoing user can read and counting the rest.
* If nothing is lost, close the ticket with the evidence.

## Owner rulings

* **Owner ruling 2026-11-20 via driver:** rows appended after the apply DO count as later work. Any row appended after the apply refuses the undo with a 409, all-or-nothing, nothing changes; the message gives a count of such rows only (no values, no ids). Same rule as HEL-1720 for everything else: name only what the undoing user can read, count the rest, no other user's names or ids in the message or INFO+ logs.

* **Owner ruling (fold-in, via driver, after the first PR head):** when undoing a patch-set `pipeline` create would delete
  one of its inline `dataset` root sources (HEL-1493 `InlineSourceCleanup` path) and that source has, since the apply,
  rows appended, apply-era rows edited, or its schema edited, refuse the WHOLE undo with a 409, nothing changes,
  counts only, same rule as the dataSource-create arm. HEL-1493 option B (a still-referenced inline source is kept and
  the undo succeeds) stays as is for the referenced case.

## Acceptance Criteria (added by fold-in)

* Red-first tests on `helio_app_test` for the inline dataset root case: appended rows, apply-era row edit and schema
  edit each refuse the whole pipeline-create undo with a 409 and nothing changes; a referenced inline source still
  follows HEL-1493 option B; with no later work the undo still removes the pipeline and the inline source.

## Agent notes

* HEL-1720's `PatchSetUndoConflictCheck` is the shared guard.
* Premise evidence: `.concertino/runs/HEL-1796/evidence/premise-validation.md` (main checkout).
