## Context

`PanelCreationModal.tsx` drives type-select → template-select → (data-bound types only) datatype-select
→ name-entry → `createPanel`. `datatype-select` (`DataTypeSelectStep.tsx`) lists DataTypes that are a
pipeline's `outputDataTypeId`; picking one sets `dataTypeId` only — `fieldMapping` stays `{}`, mapped
later via `BindingEditor`/`FieldMappingSlots`. That is the entire "binding" mechanism in this codebase
today; no auto-fieldMapping exists anywhere, even for hand-picked DataTypes.

The shape catalog (`GET /api/pipeline-shapes`) and `POST /api/pipeline-shapes/:id/expand` are live
(HEL-391/402). `PipelineDetailPage`'s `ShapePickerModal.tsx` already composes
expand → sequential `createPipelineStep` for the in-editor UX. `helio-mcp`'s
`createPipelineFromShape` composes expand → `createPipeline` → step loop client-side too (design.md:
"composing existing endpoints client-side, no new backend endpoint or duplicated expand/validation
logic"). Both shipped callers deliberately avoided a new backend endpoint for this exact composition.

## Goals / Non-Goals

**Goals:**
- Offer the ticket's own stated mapping (metric→single-row; chart→time-series/top-n; table→top-n/
  pivot-matrix) inside panel creation, driven by the live catalog, not a duplicated hardcoded catalog.
- Instantiate + run a shape into a bound panel in one modal flow, no silent failures at any stage.
- Reuse, not duplicate, the params-form and orchestration logic already shipped in HEL-402/HEL-400.

**Non-Goals:**
- `outputContract.fields` — confirmed unused this ticket too; `rowCount` (used only to justify, in this
  doc, why each mapping fits — see below) and `description` are the informative parts.
- Persisting a shape reference on panel or pipeline (Decision 2).
- Auto-populating `fieldMapping` (Decision 3).
- A new backend endpoint (Decision 1).

## Decisions

### Decision 1: no new backend endpoint — compose client-side, reusing shipped endpoints

Ticket text says "wire shape instantiation into the pipeline/panel creation service" — in this
codebase "service" is also the established name for the frontend API-wrapper layer
(`pipelineService.ts`, `panelService.ts`), not exclusively the Scala service layer. `pipelineService.ts`
already exports every primitive needed (`getPipelineShapeCatalog`, `expandPipelineShape`,
`createPipeline`, `createPipelineStep`, `runPipeline`). Two shipped callers (HEL-402's editor UX,
HEL-400's MCP tool) already compose this exact chain client-side and explicitly rejected a new backend
endpoint for it. Adding one here would be a third, divergent implementation of the same composition.
**Decision: no new backend endpoint; a new frontend orchestration path in the panel-creation flow reuses
the existing five endpoints, in the same order MCP's `createPipelineFromShape` + `runPipeline` do.**

### Decision 2: no persisted shape/panel link — undo the ticket's own suggested migration

HEL-402 design.md already decided seeded steps carry no shape provenance, explicitly flagging that
HEL-399 needs "a different, panel-level answer" *if* one is needed. No consumer needs it: nothing in
this ticket's AC re-instantiates or re-syncs a shape from an existing panel, and out-of-scope explicitly
excludes further shape-editing UX. Adding a nullable `shape`/`shape_params` column with no reader is the
same speculative-field mistake HEL-391 design.md already reversed once (the dropped `role` field).
**Decision: no migration.** If a future ticket needs "this panel came from shape X, let me re-run it
with new params," it can add the column then, with a real consumer.

### Decision 3: binding sets `dataTypeId` only — no `fieldMapping` auto-population

The existing datatype-select step never auto-populates `fieldMapping` for a hand-picked DataType — the
user always finishes the binding via `BindingEditor` post-creation. Auto-mapping from a shape's params
(e.g. an aggregate measure's `alias` → a metric's `value` slot) is *possible* since aliases are
caller-supplied and thus known before the run, but it is shape-specific heuristic code duplicating the
per-shape hardcoding this codebase's shape work has repeatedly avoided (`ShapeParamsFields` widget-by-
`dataType`, not by shape id), for four different shapes × three panel types' distinct slot vocabularies.
**Decision: match existing precedent exactly — bind `dataTypeId`, leave `fieldMapping` empty.** The
payoff ("trivial binding") is realized in the *dataTypeId* step disappearing (no more visiting
/pipelines first); field mapping was never automatic for anyone. Flagged as a candidate follow-up, not
this ticket's scope.

### Decision 4: shape offering is a static, catalog-filtered id map, informed by `rowCount`

`single-row`'s `ExactlyOne` contract is the only shape guaranteeing one row — the only shape that fits a
metric panel's single-value display; this split is fully determined by `RowCountContract` alone.
`top-n`'s `AtMostParam("n")` bounds row count to a caller-chosen small N, fitting both a bar-style chart
and a compact table — also a direct `RowCountContract` read. `time-series` and `pivot-matrix` are both
`Unbounded`, so `RowCountContract` alone does not split them; the chart-vs-table assignment between
those two rests on shape domain semantics instead — `time-series` produces one row per time bucket
(a chart's natural point-series shape), `pivot-matrix` one row per index-group (a table's natural
row-per-record shape). `passthrough` is excluded from every mapping — it performs no reduction, so
offering it adds a multi-step detour with strictly worse UX than the existing "pick an existing
DataType" path it would otherwise duplicate. **Decision:** `PANEL_TYPE_SHAPES: Record<"metric"|"chart"|
"table", string[]>` = `{metric: ["single-row"], chart: ["time-series","top-n"], table:
["top-n","pivot-matrix"]}`, used only to filter the id set from the live `GET /api/pipeline-shapes`
response — label/description/paramsSchema always come from the catalog, never hardcoded, so a future
shape addition needs one array edit, not a duplicated definition.

### Decision 5: uniform no-rollback failure handling — reuses HEL-402 Decision 6's precedent, unmodified

Four sequential calls (expand, create, N×addStep, run) each have a distinct failure mode. Rather than
inventing new compensating-delete behavior for a "hidden" pipeline (tempting since the user never chose
its name to be permanent), staying consistent with HEL-402 Decision 6's already-accepted trade-off
avoids new code and a new behavior class the skeptic would have to separately re-verify: whatever
already persisted when a stage fails (pipeline row, some steps) is left in place, discoverable and
fixable from `/pipelines` like any other pipeline. Every failure is shown inline, verbatim, non-silent —
the direct design-against for the HEL-336 defect this ticket is scoped to guard against. The panel
itself is created only after `run` succeeds — a half-run pipeline never produces a half-built panel.
**Decision:** no delete/rollback calls anywhere in the new orchestration path; `run` failures alone get
a "Retry run" affordance (re-POSTs `/run` on the same already-created `pipelineId`, no need to redo
expand/create/addStep) since a run failure doesn't imply a malformed pipeline (e.g. a transient source
error), unlike a create/addStep failure which aborts the attempt entirely.

### Decision 6: extract both the params form AND its typed-value transform out of `ShapePickerModal`

`ShapePickerModal.tsx`'s `widgetFor` drives two separate things today, both needed verbatim by the new
step: (a) the form-rendering JSX, and (b) `handleSubmit`'s string→typed-value transform (`JSON.parse`
for `object[]`, comma-split for `string[]`, `Number.parseInt` for `integer`, lines 100-126) — the part
that actually determines whether `top-n`'s `n`, `time-series`'s `measures`, or `pivot-matrix`'s `index`
decode correctly server-side (3 of the 4 offered shapes have a non-`"string"` param; only extracting the
rendering half, as an earlier draft of this design did, would leave the typing half to be independently
re-implemented in `ShapeInstantiateStep` and risk drift or a missing conversion on first use — caught at
design-gate round 1). **Decision:** extract both into
`frontend/src/features/pipelines/ui/ShapeParamsFields.tsx`:
- `ShapeParamsFields` (props: `paramsSchema`, `values`, `onChange`, `idPrefix`) — the rendering half.
- `buildShapeParams(paramsSchema, values): { params: Record<string, unknown> } | { fieldError: string }`
  — the transform half, an extraction of `handleSubmit`'s existing loop, unchanged in behavior (a
  `JSON.parse` failure returns `fieldError`, exactly matching today's `setFormError` message).

Refactor `ShapePickerModal.handleSubmit` to call `buildShapeParams` instead of its inline loop
(behavior-preserving — `ShapePickerModal.test.tsx` must still pass without edits), and have the new
`ShapeInstantiateStep`'s submit handler call both exports.

### Decision 7: output type name is an explicit required field, not derived

`POST /api/pipelines` requires a non-empty `outputDataTypeName` (`PipelineService.scala:117-118`,
`ServiceError.BadRequest("outputDataTypeName is required")`). The existing `CreatePipelineModal.tsx`
precedent collects this as its own required text field (`CreatePipelineModal.tsx:24,53,70,167`) rather
than deriving it from the pipeline name — deliberately, since a derived name risks a silent collision
with an existing DataType name with no clear resolution rule (caught at design-gate round 1: an earlier
draft asserted "auto-derived" with no rule). **Decision:** the shape-instantiate step adds a third
required field, "Output type name," identical in behavior to `CreatePipelineModal`'s field — same
validation (non-empty), same placement in the form, sent as-is to `POST /api/pipelines`. A collision or
any other `POST /api/pipelines` rejection surfaces through the same inline, verbatim, non-silent error
path as every other stage in this chain (Decision 5) — no special-cased handling.

## Risks / Trade-offs

- [Risk] A `create`/`addStep`-stage failure can leave an orphaned, empty-or-partial pipeline the user
  never explicitly asked to keep. → Mitigation: named by the user (pipeline-name field is required
  before submit), discoverable and deletable from `/pipelines` like any other pipeline; matches existing
  precedent rather than adding new compensating-delete code and its own failure modes.
- [Risk] `fieldMapping` staying empty means a shape-created panel still needs a manual editor visit to
  render data (metric shows nothing until mapped). → Mitigation: identical to today's hand-picked-
  DataType flow; not a regression, and flagged as a named follow-up candidate for the human's next-steps
  call, not silently deferred.
- [Risk] Four sequential network calls in one modal submit is slower and has more failure surface than a
  single backend round trip. → Mitigation: matches two already-shipped, already-accepted callers doing
  the same thing (HEL-402 UI, HEL-400 MCP); a granular in-modal status label ("Validating shape… /
  Creating pipeline… / Adding steps… / Running…") keeps the wait legible.

## Planner Notes

- Self-approved: Decision 1 (no new backend endpoint) — directly grounded in two already-shipped
  siblings' explicit rejection of the same endpoint for the same composition; flagged for the design
  gate since the ticket text's "Backend:" heading could be read as expecting one.
- Self-approved: Decision 2 (no migration) — the ticket itself frames this as "if needed... decide in
  design," and no consumer exists; flagged since it reverses the ticket's suggested default.
