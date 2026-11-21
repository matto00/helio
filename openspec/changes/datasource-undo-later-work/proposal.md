## Why

A patch set can create a `dataset` data source. Undoing that create calls `DataSourceService.delete`, and
`dataset_rows` cascades on the source (V106). So the undo deletes every row appended after the apply (owner appends,
editors' form submits, HEL-1784), every edit made to an apply-era row, and any schema edit. It gives no warning:
the Phase-1 check (`PatchSetUndoConflictCheck.checkDataSource`) compares only the name. Pipelines and form panels
that started using the source after the apply are protected by the delete's own reference guard. But that guard runs
only mid-walk, after the patch set's own panels, Outputs and pipelines are already gone, so the undo is partial
(200, outcome `failed`). HEL-1720's rule is a 409 with nothing changed.

## What Changes

- Undo refuses with a 409 and nothing restored when the created source has, since the apply: rows appended, apply-era
  rows edited, or its declared schema edited (owner rulings 2026-11-20 via driver). The message gives counts only.
  Row deletes do not block.
- Undo refuses in Phase 1 (409, nothing restored) when a pipeline or form panel the patch set did not create references
  the source. Visible ones are named by name or title, the rest are counted (HEL-1792 `nameList`), and no ids appear.
- The apply journals what the dataSource create made (row watermark and declared schema) in a new optional
  `JournaledEdit` field, with a fallback for journal rows written before it.
- A Phase-2 re-check right before the delete reports `failed` (count only) for work that lands during the undo.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-undo`: adds a requirement that a dataSource create undo refuses when it would delete later rows, row or
  schema edits, or break later references.

## Impact

Backend only: `services/patchsets` (conflict check, undo service, apply journaling),
`PatchSetApplicationRepository.JournaledEdit`, a narrow read on `DataSourceRepository`. No migration, no wire-shape
change: REST 409 body, MCP `undo_patch_set` and the web toast keep their current handling.

## Non-goals

- Splitting `PatchSetUndoService` (HEL-1797). Changes there stay minimal.
- Data-source row/form-submit write paths and their responses (HEL-1800's area).
- Making the Phase-2 re-check and delete one transaction.
- Inline dataset roots made by a `pipeline` create (HEL-1493 cleanup path): same loss class, different outcome
  model; raised as a follow-up triage at Delivery (design D9).
