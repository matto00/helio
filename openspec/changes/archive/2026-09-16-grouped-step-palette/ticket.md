# HEL-1136: Replace flat "Add step" op menu with a grouped, filterable step palette

## Description

The pipeline editor's add-step menu (`frontend/src/features/pipelines/ui/OpDropdown.tsx`) is a single flat list of every op in `OP_TYPES`. It holds 25 palette entries at this branch's base and is still growing with v0.8 (`upsertsource`, `convertformat`, `analyzewithai`, `generatetext`). It has already needed viewport-clamping (sweep F-040) and arrow-key fixes (F-189) just to stay usable.

Replace it with a step palette that has:

- a filter/search input that is focused when the palette opens
- ops grouped into supported-operation categories (for example: Filter & shape, Aggregate, Combine, Compute/cast, Content & files, AI, Write-back). The exact taxonomy is a design decision to settle in design.md.
- a short description per op, so users can choose without knowing op names

It opens from both current call sites — `PipelineRiverView` (trunk "+ Add step") and `BranchAffordance` — and keeps each site's insert context.

## Owner rulings (binding, 2026-09-15)

1. **The step group is backend-owned.** Declare the step group on the backend step classes via the `PipelineStep` trait (`backend/src/main/scala/com/helio/domain/model/PipelineStep.scala`), with `StepGroup` a sealed ADT, and expose it through the API. Do NOT keep a group mapping in the frontend. Whether the exposure is an existing endpoint or a new one is a design decision for design.md, with `schemas/` and `openspec/` updated in the same change. Reason: so backend usage metrics can later be aggregated per step group.
2. **Ungrouped is allowed.** The group is optional. The palette has an overview "All" view listing every registered step; a step with no group appears ONLY in "All", in no category. That is the accepted default — do not force a catch-all group, and do not make a missing group a compile error. The API must still return every registered op, with the group omitted (not null) when absent.

## Implementation notes / constraints

- Owner's suggestion is a modal. Reuse the shared `Modal` (`frontend/src/shared/ui/Modal.tsx`), as `ui/shapes/ShapePickerModal.tsx` does. Review `features/commandPalette` for existing filter + keyboard-navigation patterns before building new ones.
- Keep a failable test that every registered op appears in "All", and that an ungrouped op appears in no category (mirroring HEL-1092's classification-partition test). A newly registered op must not silently vanish from the palette.
- Keyboard (part of the AC, not polish): type to filter; arrow keys traverse the filtered results *including across group boundaries*; Enter selects; Escape closes and returns focus to the trigger. No regression of F-040 (viewport clamp) or F-189 (focus reaches the list).
- DESIGN.md is binding: tokens and shared components. The result must be compared against the RUNNING APP in both light and dark themes — token compliance alone is not evidence of visual cohesion. If the right answer would introduce a new visual dialect, escalate rather than shipping it.
- `groupby` is registered on the backend but unauthorable in the UI (absent from `OP_TYPES`, no editor); `join` is likewise excepted via `KNOWN_UNLISTED_KINDS` in `stepNarrowing.test.ts`. Decide deliberately how the palette treats a registered-but-unauthorable op — it must NOT appear as a broken choice — and state the conclusion in design.md. Whether `groupby` should exist at all is a separate spinoff; do not resolve it here.
- Deferred create is keyed on the declared per-op property `requiresCompleteConfigForCreate` (`stepNarrowing.ts:181`), derived in one place. The palette must keep routing creates through it rather than re-deriving op-name checks.
- `isTempStepId` (`stepNarrowing.ts:402`) is the single source for temp-id detection; palette code that mints steps must use it.
- Reuse the existing step-card dialect's vocabulary (row-reorder controls, per-row inline validation) rather than inventing primitives.
- No migration is expected: `V107__add_writeback_ops.sql` already admits all 27 ops, and a `StepGroup` is a code-level concern with no `pipeline_steps` column.
- spray-json hazards that bite directly here: `None` fields are DROPPED on the wire, so an ungrouped step's group field is ABSENT, not null — normalize at the boundary and test with the field absent. `JsObject` keys are sorted, so anything order-bearing (group ordering, op ordering within a group) must be an ARRAY, not an object.

## Corrected premises (verified against base abe2a8fa; see .concertino/runs/HEL-1136/evidence/premise-validation.md)

- The ticket says "~51 implementors" of `PipelineStep`. Ground truth: `PipelineStep.Registry` has **27** entries, with one `extends PipelineStep` per file in `domain/steps/` (27) and 27 further references in `PipelineStepProtocol.scala`. "~51" double-counts domain + protocol. The ruling is unaffected — it is 27 step classes.
- The ticket says "21+ ops"; `OP_TYPES` has **25** palette entries at base.
- `PipelineRiverView` renders `OpDropdown` at **three** sites (lines 317, 389, 529), plus `BranchAffordance` at line 42 — four render sites across two components, not two. Each must keep its own insert context.
- `allowedOps` is NOT cited by this ticket and exists at base only inside archived `openspec/changes/archive/2026-05-*` documents — no live Scala/TS surface. Nothing to unwind.

## Acceptance criteria

- Filtering narrows results live, and an empty result shows an empty state.
- Groups are declared on the backend step classes and exposed by the API. The palette renders categories purely from that data, with no frontend mapping.
- An "All" view lists every registered step, and an ungrouped step appears only there.
- A test goes red if a registered op is missing from "All".
- Both call sites insert the chosen step at the correct position.
- Keyboard-only add-step works end to end.
