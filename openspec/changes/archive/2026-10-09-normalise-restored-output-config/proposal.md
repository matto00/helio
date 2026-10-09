## Why

V117 (HEL-1387) repaired stored Output configs carrying V94/HEL-877 dead keys, but patch-set journals were deliberately
left as point-in-time records. Undoing a pipeline-step delete journaled before V117 recreates its bound Outputs from the
journaled config verbatim, so the dead keys come back and the renamed live key (`label`, `annotation`, `layout`,
`sort`) is missing: the settings silently stop rendering again (HEL-1409, option (a)).

## What Changes

- A pure Scala normaliser that applies V117's mapping (rename/drop rules, kind applicability, value validity,
  never-overwrite-a-live-key) to one Output config.
- Patch-set undo of a `pipelineStep` delete normalises each bound Output's journaled config before recreating it.
- `OutputService.update` under `RestorePriorStored` (patch-set mid-apply rollback) normalises the merged config it writes.
- A parity test runs V117's own DO block over a case corpus and asserts the Scala normaliser produces identical configs.
- Journals are not rewritten; no migration.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-undo`: restored Output configs never reintroduce V117-repaired dead config keys.

## Impact

Backend only: `services/patchsets/PatchSetUndoService`, `services/pipelines/OutputService`, a new normaliser object
next to `OutputConfigValidation`, and tests (undo red test, unit tests, V117 parity spec on embedded Postgres).
No API shape change, no frontend change, no migration.

## Non-goals

- V118 (HEL-1410) object-valued `format` mapping at restore time — same class of gap, separate ticket.
- Writing audit rows for restore-time normalisation (the journal itself still holds the original values).
- Rewriting stored journals.
