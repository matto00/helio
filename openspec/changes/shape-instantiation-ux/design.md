## Context

The shape catalog (`GET /api/pipeline-shapes`, HEL-391) and all four concrete shapes (`single-row`,
`top-n`, `time-series`, `pivot-matrix`, HEL-393/394/396/398) are shipped on main. Every shape's `expand`
is a pure `JsObject => Either[String, Vector[ShapeStepExpansion]]` function, deliberately never exposed
over HTTP by HEL-391 (`PipelineShapeService` "drops the shape's `expand` behavior" — see its own doc
comment) pending a real caller. This ticket is that caller. The editor is `PipelineDetailPage.tsx` +
`PipelineRiverView.tsx` + `OpDropdown.tsx`; step creation already goes through `createPipelineStep`
(`pipelineService.ts`) and already has a precedent for surfacing a failed POST as a toast rather than
swallowing it (`PipelineDetailPage.handleAddStep`, fixed post-HEL-336).

## Goals / Non-Goals

**Goals:**
- Let a user pick a shape, fill its params, and seed the resulting steps into the current pipeline.
- Seeded steps are indistinguishable from hand-authored steps to every downstream consumer.
- A failed expand or a failed step-create is always visible to the user, never silent.

**Non-Goals:**
- A fully validating, schema-driven form generator — `paramsSchema` is descriptive metadata only.
- Persisting any link from a step back to the shape that produced it (see Decision 2).
- Rendering `outputContract.fields` (empty for every shape today, per orchestrator brief).
- Wiring shapes into `CreatePipelineModal` (no pipeline id exists yet at that point — see Decision 1).

## Decisions

### Decision 1: instantiation lives only in the pipeline editor, not the create-pipeline modal

`CreatePipelineModal` collects `name`/`sourceDataSourceId`/`outputDataTypeName` and calls
`POST /api/pipelines` — no pipeline id exists until that call returns, and step creation
(`createPipelineStep`) requires one. Bolting a shape picker onto the create flow would mean either a
second round-trip after creation (no real UX win over just opening the editor) or holding steps
client-side until a later "create" — a bigger, riskier change than this ticket's scope. The ticket
title itself says "in the pipeline editor." **Decision: the "Start from a shape" affordance lives in
`PipelineRiverView` only** (both the empty-state CTA and the "+ Add" row, mirroring where `OpDropdown`
already lives), reachable once a pipeline exists.

### Decision 2: seeded steps are plain, unlinked steps (flagged for HEL-399)

Two options: (a) seeded steps are ordinary `Step`s with no provenance, editable and deletable like any
other step; (b) steps carry a `sourceShapeId`/`sourceShapeParams` tag so a later feature (e.g. "re-run
this shape with new params") could recompute them. The ticket's AC explicitly says "no special-casing
downstream," and `PipelineStepConfig`/`ShapeStepExpansion` share no such field today — adding one would
touch the step wire shape, contradicting the proposal's "no change to existing step CRUD wire shapes."
**Decision: (a).** This is the ticket's recommended default, but it is called out loudly here because
**HEL-399 (panel-declares-shape wiring) needs a different, panel-level answer to "how does a panel know
its steps came from a shape."** HEL-399 must not assume step-level linkage exists — it doesn't, after
this ticket ships.

### Decision 3: instantiating into a non-empty pipeline appends

Three options: append, replace, refuse. Replace is destructive with no confirm-dialog precedent in this
codebase for step lists (deletion is always per-step, via `onRemoveStep`). Refuse blocks a real use case
(user hand-adds one step, then wants a shape's steps after it) for no safety benefit — nothing is lost by
appending. **Decision: append**, matching `handleAddStep`'s existing always-append behavior for manually
picked ops. No new confirmation UI needed.

### Decision 4: new `POST /api/pipeline-shapes/:id/expand` endpoint (self-approved scope extension)

The ticket text scopes this as frontend-only and names `GET /api/pipelines/shapes` (verified during
planning to actually be `GET /api/pipeline-shapes` — see `ticket.md` correction). Neither the ticket text
nor any shipped ticket added an HTTP path to `PipelineShape.expand`; without one, the frontend cannot
turn `{shapeId, params}` into steps except by re-implementing every shape's validation/expansion logic in
TypeScript — duplicating server-side business logic shape-by-shape, the opposite of "not hardcoded per
shape where avoidable," and guaranteed to drift as shapes evolve. `PipelineShapeService`'s own doc
comment anticipated exactly this: a later caller (naming HEL-400's MCP tool, and by the same logic this
ticket) needs `expand` reachable without holding the shape's executable reference directly.
**Self-approved**: add `PipelineShapeService.expand(id, params): Future[Either[ServiceError, Vector[ShapeStepExpansion]]]`
(wrapping the synchronous `Either` in `Future.successful` — `expand` itself is pure/synchronous, but
`ServiceResponse.run` requires a `Future[Either[ServiceError, A]]`, matching every other route's call
shape)
(404 via `PipelineShape.shapeFor`'s `Left`, 422 via the shape's own `expand` `Left`) and
`POST /api/pipeline-shapes/:id/expand` on the existing `PipelineShapeRoutes`, following the exact
`ServiceResponse`/`ServiceError` pattern every other mutating route already uses (`PipelineStepRoutes` is
the closest sibling). This is additive, ~40 lines across 2 existing files + 1 new wire-type pair, no
migration, and directly reusable by HEL-400 later — flagged here for the design gate's scrutiny, not
buried.

### Decision 5: generic params form keyed on `ShapeParamDescriptor.dataType`

`paramsSchema` entries carry only `{name, label, dataType, required, description}` — no enum values, no
cross-field conditionals (e.g. `single-row`'s `measures` is only meaningful when `mode = "aggregate"`).
Four `dataType` strings occur across all four shapes today: `"string"`, `"string[]"`, `"integer"`,
`"object[]"`. **Decision:** render one widget per `dataType`, in `paramsSchema` order, every field always
visible (no client-side conditional show/hide — the schema doesn't declare the dependency, and inferring
it per-shape would be exactly the per-shape hardcoding the AC asks to avoid):
- `"string"` → `TextField`
- `"string[]"` → `TextField`, comma-split/joined (mirrors `SelectFieldsConfig`'s existing convention
  for field-list inputs elsewhere in this editor)
- `"integer"` → `TextField` type=number, parsed with `Number.parseInt`
- `"object[]"` → `Textarea`, raw JSON array text, parsed with `JSON.parse`; a parse failure is a
  client-side inline error (not a server round-trip); each field's `description` (already prose like
  `"non-empty array of { fn, field, alias }"`) is shown as helper text since it is the only per-field
  guidance available
- any other/unrecognized `dataType` → falls back to the `"string"` widget (forward-compatible with a
  future shape adding e.g. `"boolean"`, never a hard crash)

`required` is enforced client-side only as "must be non-empty before submit is enabled" — the
authoritative required/format/cross-field validation is `expand`'s own `Left(message)`, surfaced verbatim
in an inline form-level error banner on 422 (see Decision 6). This is the direct design-against for the
HEL-336 defect: **the empty-default failure mode here is a user submitting with an empty/invalid field
and the 422 response's message must appear on screen**, not vanish.

### Decision 6: sequential expand → per-step POST, non-atomic, always-visible failure

`expand` returns an ordered `Vector[ShapeStepExpansion]`; each is POSTed via the existing
`createPipelineStep(pipelineId, kind, config)` one at a time, awaited in order (mirrors `handleAddStep`'s
single-step version of the same call). On a 422 from `/expand` itself: show the message in the modal, do
not close it, no steps are created (expand hasn't produced any). On a failure partway through the
per-step POST loop (a real backend 5xx, not an expected case since `expand`'s own contract tests prove
every expansion decodes cleanly): stop the loop, keep whatever steps already succeeded (they are already
persisted — no compensating DELETE, consistent with `handleRemoveStep`'s existing no-rollback local-only
delete semantics), close the modal, and push an error toast naming how many of N steps were added and
that the shape did not fully apply. This is deliberately the same asymmetry `handleAddStep` already has
(temp step kept locally, failure surfaced via toast) rather than inventing a new all-or-nothing
transaction the rest of the editor doesn't have.

## Risks / Trade-offs

- [Risk] Generic `object[]` params (raw JSON textarea) are a rough UX for `single-row`'s
  `measures`/`conditions` and `time-series`'s `measures` — a power-user affordance, not
  point-and-click. → Mitigation: acceptable for v1 per the ticket's own "not hardcoded per shape where
  avoidable" AC; `description` text carries the expected shape; a follow-up ticket could add structured
  sub-builders once real usage data shows which shapes need it most.
- [Risk] All params fields always visible (no mode-conditional show/hide) means a user can fill in
  `measures` while `mode = "filter"` and get a confusing 422. → Mitigation: the 422 message is shape-authored
  and already names the mismatch (e.g. "missing required field 'conditions' ... when mode is filter");
  surfaced verbatim, not swallowed.
- [Risk] Partial-apply on a mid-loop POST failure leaves an inconsistent-looking pipeline (some but not
  all of a shape's steps present). → Mitigation: toast names the exact count; every already-created step
  is a normal, editable, deletable step (Decision 2), so recovery is just "delete the partial steps and
  retry" — no hidden state.

## Planner Notes

- Self-approved: Decision 4 (new backend endpoint) — ticket text says "Frontend:" only, but the shipped
  `PipelineShapeService` doc comment explicitly anticipated this exact follow-on caller, the change is
  small and pattern-matched to existing sibling routes, and there is no way to satisfy the ticket's core
  ACs without it. Flagged prominently for the design-gate skeptic.
- Self-approved: Decisions 1/3 (editor-only, append-on-conflict) per the ticket's own explicit "decide
  deliberately" prompts in scope section — both have a single clearly-safer answer given existing
  precedent in this codebase.
