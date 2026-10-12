## Why

HEL-1436 made `cast` reject unsupported targets at write and produce real float/number/date/timestamp values, but three
gaps remain: duplicating a step bypasses the strict write-path config check every other write surface runs, the editor's
cast picker cannot select the targets the backend now supports (and mis-renders stored unsupported ones), and the
`pipeline-cast-op` spec still carries a placeholder Purpose.

## What Changes

- `POST /api/pipeline-steps/:id/duplicate` runs the same strict write-path config check as create/update on the config it
  would write and returns the same 422 on rejection; incomplete drafts stay duplicable.
- The editor's cast target dropdown offers exactly the backend-supported targets (adds float, number, date, timestamp),
  pinned to the backend list by a guard test.
- A stored cast target outside the supported set is shown in the dropdown as itself, marked unsupported, instead of
  rendering as "keep as is".
- `pipeline-cast-op` spec Purpose filled in.
- Test depth: legacy-target passthrough proven through the real pipeline-run submit path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-step-lifecycle`: duplicate rejects a config the write-path check rejects (422), keeps drafts duplicable.
- `pipeline-cast-op`: the frontend dropdown offers the full supported target set and shows stored unsupported targets.

## Impact

- Backend: `PipelineStepWrites.duplicateStep`; `ConvertFormatConfig.scala` writer omits empty from/to (draft responses
  no longer carry `"from":"","to":""`); route tests in `PipelineStepRoutesSpec` (or a new spec).
- Frontend: `CastFieldsConfig.tsx` and a guard test; the duplicate error surfacing path if a 422 is swallowed.
- Specs: `openspec/specs/pipeline-cast-op/spec.md` Purpose.

## Non-goals

- Spark `sparkDataType` float→FloatType wiring (HEL-238).
- Changing which configs create/update accept, or the run/analyze gates' tolerance of stored legacy configs.
- Collapsing the synonym targets (float/double/number) into one UI choice.
