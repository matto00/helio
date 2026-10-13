## Why

Three step-config text inputs (convertformat "Destination field", compute "Output field name" and "Expression",
upsertsource "New source name") call their change handler again on blur with the value already committed on the last
keystroke. The debounced persist then sends a second, byte-identical `PATCH /api/pipeline-steps/:id` about 400 ms after
focus leaves the field (HEL-1484 item 7, reproduced live for convertformat).

## What Changes

- Remove the redundant `onBlur` re-emit from the three controlled inputs; `onChange` alone already commits each edit.
- Replace the unit tests that pin "blur calls onChange" with tests pinning "blur does not call onChange".
- Add a StepCard-level test: change then blur on each field yields exactly one `updatePipelineStep` call.
- Before/after live network probes for every field in scope.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-editor-page`: ADDED requirement that moving focus out of a step-config text field does not re-save an
  unchanged config.

## Impact

- `frontend/src/features/pipelines/ui/stepConfigs/{ConvertFormatConfig,ComputeFieldConfig,UpsertSourceConfig}.tsx`
  and their tests. No backend, schema, API or migration change.

## Non-goals

- No "config unchanged" dedupe guard in `useStepCardPersist` (would change wire behaviour pinned by the
  characterization test, and could suppress a deliberate retry of a failed save).
- No change to the 400 ms debounce, nor to what happens to a pending debounced save when the card unmounts.
