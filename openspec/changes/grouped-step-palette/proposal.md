## Why

The pipeline editor's add-step menu is a flat list of all 25 ops in the frontend's `OP_TYPES` array, which is
today the *entire* enumeration of authorable steps — an unreviewed frontend mapping whose inclusion rules
(join excluded, union/lookup/assert included) exist only as hand-written comments. It has already needed a
viewport clamp (F-040) and arrow-key fixes (F-189) to stay usable, and v0.8 added four more ops. Users must
know op names to choose, and the backend cannot aggregate usage per step group because no group exists.

## What Changes

- Declare a step group and a catalog description as kind-level metadata on the backend, with `StepGroup` a
  sealed ADT and the group **optional** (absent is allowed and is the accepted default).
- Add a read-only, authenticated catalog endpoint that projects `PipelineStep.Registry` into an ordered wire
  response: every registered kind, with its group omitted when absent, plus the declared group display order.
- Declare per-kind **authorability** on the backend, replacing the frontend's `KNOWN_UNLISTED_KINDS`
  exception list, so a registered-but-unauthorable op (`join`, `groupby`) can never render as a broken choice
  and a newly registered op cannot silently vanish.
- Replace `OpDropdown` with a modal step palette: focused filter input, grouped results, an "All" overview, a
  per-op description, and an empty state. Categories render purely from catalog data — no frontend group map.
- Keyboard: type to filter, arrow keys across filtered results including across group boundaries, Enter
  selects, Escape closes and restores focus to the trigger.

## Capabilities

### New Capabilities
- `pipeline-step-catalog-api`: backend-owned step group/description/authorability ADT and the catalog endpoint exposing it.
- `pipeline-step-palette`: the grouped, filterable add-step palette UI, its keyboard contract, and its empty state.

### Modified Capabilities
- `pipeline-editor-page`: the gap-insert affordance is specified as opening an op picker *anchored at that gap*; it now opens the modal palette while preserving each site's insert position.

## Non-goals

- Whether `groupby` should remain registered at all (separate spinoff).
- Any change to step editors, step-card UI, or the create/reorder endpoints' semantics.
- Persisting the group in `pipeline_steps`; no migration (V107 already admits all 27 ops).
- Emitting the per-group usage metrics the ruling enables; this change only makes them possible.

## Impact

- Backend: `domain/model/PipelineStep.scala` (`Companion` trait), a new `StepGroup` ADT, ~27 step companions in
  `domain/steps/`, a new catalog service + routes + protocol, `ApiRoutes.scala` wiring.
- Contract: new `schemas/pipelines/*.json`, new openspec specs, modified `pipeline-editor-page` spec.
- Frontend: new palette component + CSS, `pipelineService.ts`, `stepNarrowing.ts` (`OP_TYPES` becomes an
  icon map keyed by kind), four `OpDropdown` render sites across `PipelineRiverView`/`BranchAffordance`,
  and `OpDropdown` + its tests retired.
