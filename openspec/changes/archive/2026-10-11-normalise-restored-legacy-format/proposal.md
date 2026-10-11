## Why

V118 (HEL-1410) mapped the legacy object-valued `format` that V94 copied onto metric/collection Outputs into a supported
string format (moving its text into `unit`). Patch-set journals are point-in-time records and were not rewritten, so
undoing a `pipelineStep` delete journaled before V118 recreates bound Outputs with the object `format` again; the
reader accepts only strings, so number format and unit silently stop rendering. HEL-1409 closed the same class of gap
for V117's dead keys and explicitly left V118 as a follow-up. The HEL-1409 parity spec also has corpus holes that let
two plausible mutations survive, and leaks JDBC statements. Item 3 of the ticket (single-call create skipping HEL-1313
key validation) does not reproduce on main and needs only recorded verification.

## What Changes

- A pure Scala mirror of V118's section-3 mapping (`format` object -> `integer`/`currency`/`number`, unit text written
  only into an absent/JSON-null `unit` on metrics), applied after the existing V117 mirror at both captured-config
  restore sites: `PatchSetUndoService.restoreBoundOutputs` and `OutputService.update` under `RestorePriorStored`.
- A parity spec running V118's real DO block on TEMP tables against the Scala mirror.
- V117 parity spec: cross-enum nested values, non-string non-null live values, closed JDBC resources.
- End-to-end undo test extended with V118 object-format rows (red first) and collection layout / chart annotation rows.
- Item 3: mutation-proof evidence that existing coverage pins single-call create's key validation; no code change.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-undo`: restored Output configs also never reintroduce V118-repaired object-valued `format`.

## Impact

Backend only: `services/pipelines` (new mirror object), `services/patchsets/PatchSetUndoService`,
`services/pipelines/OutputService`, tests. No API shape change, no frontend, no migration, no stored-data change.

## Non-goals

- Rewriting journals or writing audit rows for restore-time normalisation.
- Any change to `ValidateWrite` / HEL-1313 tolerance, or to single-call create (item 3 already satisfied).
