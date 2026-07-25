## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket + all planning artifacts read**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/panel-creation-shape-step/spec.md`, `specs/panel-creation-datatype-step/spec.md`.

- **Decision 1 (no new backend endpoint, compose client-side) — grounded, verified against real code,
  not just asserted.**
  - `GET /api/pipeline-shapes` and `POST /api/pipeline-shapes/:id/expand` exist today
    (`backend/src/main/scala/com/helio/api/ApiRoutes.scala:272`).
  - `helio-mcp/src/helioApi.ts:380-400` (`createPipelineFromShape`) does exactly
    `expandPipelineShape` → `createPipeline` → sequential `addPipelineStep`, with `runPipeline` kept
    as a separate, explicit call (`helio-mcp/src/tools/write.ts:283`, `:307`) — matches the design's
    claimed precedent call-for-call, including the "run is separate" detail.
  - `PipelineDetailPage.handleInstantiateShape` (`frontend/src/features/pipelines/ui/PipelineDetailPage.tsx:313-327`)
    does the same expand-then-sequential-createPipelineStep composition for the in-editor UX.
  - Conclusion: Decision 1 is well-grounded, not hand-waved.

- **Decision 2 (no persisted shape link) — grounded.** `openspec/changes/archive/2026-07-25-shape-instantiation-ux/design.md:38-48`
  (HEL-402 Decision 2) explicitly states seeded steps carry no provenance and explicitly defers to
  HEL-399 for "a different, panel-level answer... if one is needed." This design does not add one,
  and states no consumer requires it. Confirmed neither `PipelineStepConfig` nor `ShapeStepExpansion`
  (`frontend/src/features/pipelines/types/pipelineShape.ts`) carry a shape-id field. No violation of
  the pre-settled constraint.

- **`outputContract.fields` untouched** — confirmed `OutputContract.scala` still declares
  `fields: Vector[OutputFieldContract]` with no params-awareness, and the design explicitly restates
  it stays unused (Non-Goals, design.md:25-26), correctly reporting per orchestrator constraint 7.

- **RowCountContract facts for Decision 4 checked against the actual shape sources**:
  `SingleRowShape.scala:88` → `ExactlyOne`; `TopNShape.scala:63` → `AtMostParam("n")`;
  `TimeSeriesShape.scala:77` → `Unbounded`; `PivotMatrixShape.scala:78` → `Unbounded`. The
  single-row→metric and top-n→chart/table claims are directly grounded in the type. The
  time-series-vs-pivot-matrix chart/table split, however, is **not actually distinguishable by
  `RowCountContract`** — both are `Unbounded`. The design's own prose concedes this by falling back to
  domain semantics ("one row per time bucket" vs "one row per index-group") rather than the type
  itself. This is a minor overclaim in the "justified by rowCount" framing (non-blocking — see notes).

- **Failure-handling design (Decision 5) traced against the HEL-336 guard and the spec scenarios**:
  the panel's `dataTypeId` is set only after `run` succeeds (spec.md `panel-creation-shape-step`
  lines 21-27, 42-53); every pre-run failure is inline/verbatim and non-silent; a run failure alone
  gets "Retry run" against the already-created `pipelineId`. This does prevent a half-built panel with
  silent failure — the specific defect class the ticket is designing against. Confirmed no
  contradiction with the cited HEL-402 Decision 6 no-rollback precedent
  (`shape-instantiation-ux/design.md:104-116`).

- **Panel-type→shape mapping matches the ticket's own literal text** (`ticket.md:16`) exactly —
  `PANEL_TYPE_SHAPES` in design.md:77-80 reproduces metric→single-row, chart→time-series/top-n,
  table→top-n/pivot-matrix verbatim; not invented.

- **`DataTypeSelectStep.tsx` / `PanelCreationModal.tsx` read directly** to confirm the plumbing is
  plausible: `DATA_BOUND_TYPES` already includes metric/chart/table (and others correctly excluded
  from shape-offering per the design); `selectedDataTypeId` is set via plain `useState` with no
  dependency on the fetched DataTypes list, so setting it from a freshly-created pipeline's output
  works without further wiring changes; `NameEntryStep.tsx` has zero references to
  `selectedDataTypeId`/`dataTypeId` (grep returned nothing), so no downstream consumer assumes the
  DataType pre-exists in the fetched registry.

- **`sourcesSlice`/`fetchSources` confirmed to exist and be an established reuse pattern**
  (`frontend/src/features/sources/state/sourcesSlice.ts`, already used by `CreatePipelineModal`,
  `LookupConfig.tsx`, `UnionConfig.tsx`).

### Two concrete gaps found

1. **Decision 6 / task 1.1's extraction is incomplete, undermining its own stated purpose.**
   `ShapePickerModal.tsx`'s `widgetFor` function is used in two places: (a) the form-rendering JSX
   (line ~210) and (b) the submit-time typed-param transform loop inside `handleSubmit`
   (lines 96-126: `JSON.parse` for `object[]`, comma-split for `string[]`, `Number.parseInt` for
   `integer`). Task 1.1 only extracts "`widgetFor` + per-`dataType` form rendering" into
   `ShapeParamsFields.tsx`; task 1.2 confirms `ShapePickerModal.test.tsx` must pass **unmodified**,
   meaning `handleSubmit`'s transform loop stays put, untouched, in `ShapePickerModal.tsx`. Nothing in
   design.md or tasks.md assigns a home for the equivalent transform the new `ShapeInstantiateStep.tsx`
   needs before it can call `expandPipelineShape` with correctly-typed params (task 3.2 just says
   "Implement the submit handler: `expandPipelineShape` → ..." with no mention of where the
   string→typed-value conversion comes from). Decision 6's own rationale for extracting is "Duplicating
   it would mean two copies to keep in sync across every future shape's new `dataType`" — but as
   scoped, only the *rendering* half is de-duplicated; the *typing* half (the part that actually
   determines whether `top-n`'s `n`, `time-series`'s `measures`, or `pivot-matrix`'s `index` decode
   correctly server-side) is left to be independently re-implemented, risking drift or an outright
   missing conversion (e.g. sending `n` as a raw string) on the very first shape param that isn't
   `dataType: "string"` — which is 3 of the 4 offered shapes (`top-n`, `time-series`, `pivot-matrix`
   all have non-`"string"` params; only `single-row`'s simplest fields are plain strings).

2. **"Auto-derived output type name" is asserted with no derivation rule anywhere.**
   `specs/panel-creation-shape-step/spec.md:22-24` says submission calls `POST /api/pipelines` "with
   the entered name/source and an auto-derived output type name," but the step only collects a
   pipeline name and a data source (spec.md:4-7) — no separate output-DataType-name field, unlike the
   existing `CreatePipelineModal.tsx` precedent, which requires the user to type `outputDataTypeName`
   as a distinct required field (`CreatePipelineModal.tsx:24,53,70,167`). Neither `design.md` nor
   `tasks.md` contains the string "auto-derived" anywhere except that one spec line, and no Decision
   states the derivation rule (e.g. `${pipelineName}` vs `${pipelineName} output` vs
   `${shapeLabel} output`, or how a collision with an existing DataType name is surfaced). This is a
   genuine implementation-blocking ambiguity a competent implementer could resolve two different ways.

### Verdict: REFUTE

### Change Requests

1. Extend Decision 6 (design.md) and task 1.1 (tasks.md) to also extract the params-string→typed-value
   transform (the `widgetFor`-driven `JSON.parse`/comma-split/`Number.parseInt` logic currently inline
   in `ShapePickerModal.handleSubmit`, lines 100-126) into a shared, exported function alongside
   `ShapeParamsFields` (e.g. `buildShapeParams(paramsSchema, values): { params: Record<string, unknown> } | { fieldError: string }`),
   and have both `ShapePickerModal.handleSubmit` and the new `ShapeInstantiateStep`'s submit handler
   call it. Update task 1.2 to note `ShapePickerModal.handleSubmit` is refactored to use the shared
   transform (test file can still pass unmodified if behavior is preserved exactly).
2. Add a Decision (or extend Decision 4/6) in design.md that states the exact output-DataType-name
   derivation rule used for the `POST /api/pipelines` call in the shape-instantiate submit handler, and
   thread it into task 3.2. State what happens on a name collision (does the existing
   `outputDataTypeName is required`-style 4xx from `PipelineService.scala:117-118` surface as one more
   inline, verbatim error per the same failure-handling convention, or is there a distinct rule)?

### Non-blocking notes

- Decision 4's "justified by rowCount" framing overstates what `RowCountContract` alone can do: both
  `time-series` and `pivot-matrix` share `Unbounded`, so the chart/table split for those two actually
  rests on shape-domain semantics (time-bucket vs. index-group), not the `rowCount` value itself. The
  static map is still correct and matches the ticket's own literal mapping — just tighten the
  justification prose so a future reader doesn't assume `rowCount` alone disambiguates those two.
- Task 2.3's "fetch the shape catalog on mount" fires for every panel-creation-modal open, including
  non-data-bound types (`image`) that never reach `datatype-select`. Minor, avoidable network call —
  worth a one-line note to gate the fetch on `isDataBound(selectedType)` reaching the relevant step,
  not required to block design approval.
