## Why

HEL-1316 added rolling window functions. Its final skeptic proved live that invalid rolling-frame configs are rejected with 422 on every write surface, but no test pins that on the patch-set apply and pipeline proposal routes, so a regression in either route's validation wiring would go unnoticed. Separately, the window step editor uses hard-coded DOM ids, so two open window cards produce duplicate ids and labels that point at the wrong input. One `case` block in `WindowStep.scala` is misaligned.

## What Changes

- Add route-level backend tests pinning rolling-frame rejection (422, frame message, nothing stored) on `POST /api/patch-sets/apply` (pipelineStep create, pipelineStep update, pipeline create edits) and `POST /api/pipelines/apply-proposal`, each proven red under a one-line mutation.
- Replace the hard-coded `window-offset-input`, `window-frame-size-input` and `window-output-column` ids in `WindowConfig.tsx` with `useId()`-derived ids, with a two-editor uniqueness test.
- Align the `case` arrows in `WindowStep.scala`'s non-rolling function match (cosmetic; no behaviour change).
- Out of scope: centred rolling frames (item 1 of the ticket) — needs owner product rulings.

## Capabilities

### New Capabilities

### Modified Capabilities

- `pipeline-window-op`: the window step editor's input ids are unique per card instance.

## Impact

- Frontend: `frontend/src/features/pipelines/ui/stepConfigs/WindowConfig.tsx` plus a new/extended test.
- Backend: test-only additions under `backend/src/test/scala/com/helio/api/routes/{patchsets,pipelines}/`; whitespace-only edit to `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala`.
- No API, schema, migration or behaviour change.
