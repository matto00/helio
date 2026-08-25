## Why

HEL-411's final gate found and fixed a live-reproduced silent-data-corruption bug in `aggregate`/`groupby`
pipeline-step config decoding: a wrong-shape refinement edit could pass `PatchSetPreviewService.preview`'s
decode-only check and silently collapse the pipeline's real output. Whether `join`/`pivot`/`window`/`unpivot`
share this same risk was confirmed only by a code read, live-verified for `window` once. This change closes
that gap with real live trials and, where confirmed, the same fix HEL-411 applied.

## What Changes

- Live-verify (real `POST /api/refinements` trials against this worktree's backend) whether the existing
  general "config must match current shape" prompt rule prevents a wrong-shape edit for `join`, `pivot`,
  `window`, and `unpivot` — mirroring HEL-411's own reproduction method.
- For any step kind whose coverage gap is confirmed live: add a worked UPDATE example to
  `RefinementEditShape` and extend `RefinementEditShapeSpec` with a decode-and-assert-actual-values test
  (not merely decodes-without-throwing).
- No decoder-hardening (raise-on-mismatch) work is committed to this change's default scope — see
  Non-goals.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conversational-refinement`: extends the existing `aggregate`/`groupby` worked-example prompt-grounding
  guarantee (HEL-411) to `join`/`pivot`/`window`/`unpivot` — one new ADDED requirement (see
  `specs/conversational-refinement/spec.md`) stating that grounding for these four step kinds SHALL include
  a worked UPDATE example decoder-verified (by regression test) to produce a non-empty, correctly-populated
  config. This is a prompt-grounding/test guarantee, not a decoder-level one — it does not change decode-time
  behavior for any caller.

## Impact

- `backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala` (four new worked
  examples — join/pivot/window/unpivot — added unconditionally).
- `backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala` (four new
  regression-guard tests, one per new example, asserting actual decoded values).
- No API/wire-shape changes; no migrations.

## Non-goals

- Making the affected config decoders (`JoinConfig`/`PivotConfig`/`WindowConfig`/`UnpivotConfig`) raise on
  shape mismatch instead of silently defaulting — evaluated during Planning as an explicit scope decision;
  coordinator decided `defer-to-followup`. Not part of this change.
- `FilterStep`/`SortStep` — confirmed (code read, coordinator) to share the flatMap-drop-on-item-mismatch
  mechanism, but were never named in HEL-671's acceptance criteria. Findings reported for a separate
  follow-up ticket; not addressed here.
