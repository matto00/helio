## Context

Today a pipeline is a raw ordered list of `PipelineStep`s (`PipelineStep.scala`), each with a typed
`*Config` and a `PipelineStep.Registry: Map[String, Companion]` keyed by kind string
(`RenameStep.Kind -> RenameStep.companion`, ...). HEL-337's vision wants a higher-level primitive — a
named, parameterized "shape" (single-row / top-N / time-series / pivot) that expands into ordinary
steps and declares the output row-shape it guarantees. This ticket is the foundation: the abstraction,
registry, and catalog endpoint. Seven sibling tickets (4 concrete shapes + panel binding + MCP + editor
UX) depend on the contract landed here.

The closest precedent is HEL-484's `ConnectorRegistry`/`ConnectorMetadata`: a dependency-free
code-level registry (`backend/src/main/scala/com/helio/domain/ConnectorRegistry.scala`) exposed via a
thin `GET /api/connectors` route with no DB. `PipelineShape.Registry` follows the same shape-of-solution
but mirrors `PipelineStep.Registry`'s map-of-companions structure more closely, since shapes are a
sibling concept to steps, not a sibling concept to connectors.

## Goals / Non-Goals

**Goals:**
- Pin the `PipelineShape` contract: id/label/description, a typed params model, `expand`, `outputContract`.
- A registry that can't silently drift (mirrors `ConnectorRegistrySpec`'s parity-test pattern).
- A catalog endpoint whose response shape the sibling tickets (HEL-400 MCP, HEL-402 UI) can build against.
- One trivial reference shape, registered for real, that exercises `expand` end-to-end.

**Non-Goals:**
- Any of the 4 concrete shapes' actual business logic (single-row/top-N/time-series/pivot).
- Persisting a shape reference on a pipeline/panel (no migration).
- Runtime "apply this shape to my pipeline" endpoint — `expand` is a pure function tested directly;
  wiring it into `POST /api/pipelines/:id/steps` (bulk-create-from-shape) is a sibling ticket's call.

## Decisions

**1. `expand` returns a domain-level `ShapeStepExpansion(kind: String, config: JsObject)`, not the
API-layer `CreatePipelineStepRequest`.** Domain code (`com.helio.domain.shapes`) must not import
`com.helio.api.protocols` (layering: domain has no business depending on the wire DTO package,
services sit between them). `ShapeStepExpansion` mirrors the same two-field shape as
`CreatePipelineStepRequest(`type`: String, config: JsObject)` positionally (`kind` ↔ `` `type` ``,
`config` ↔ `config`) — not a literal field-name match, since the API DTO's discriminator field is the
backtick-quoted keyword `` `type` ``, not `kind`. A service-layer or test-only 1:1 mapping
(`CreatePipelineStepRequest(exp.kind, exp.config)`) is what AC3 ("expansion produces steps valid
against the existing step CRUD/validation path") actually exercises: `PipelineShapeServiceSpec` maps
the reference shape's expansion through `PipelineStepConfigCodec.decode(kind, config.compactPrint)`
(the same decode `PipelineService.addStep` calls) and asserts it succeeds. *Alternative rejected*:
return `CreatePipelineStepRequest` directly — couples the domain package to the API package for no
behavioral gain.

**2. `outputContract` is shape-level (declared once, on the trait), not computed per-invocation.**
`OutputContract(rowCount: RowCountContract, fields: Vector[OutputFieldContract], description: String)`.
`RowCountContract` is a small closed ADT — `ExactlyOne`, `AtMostParam(paramName: String)`, `Unbounded`
— chosen to be expressive enough for all 4 sibling shapes without presuming their internals: single-row
→ `ExactlyOne`; top-N → `AtMostParam("n")` (the *shape* doesn't know its own N ahead of a call, but it
does know which param bounds it); time-series/pivot → `Unbounded` (bucket/row count is data-dependent).
`fields` is `Vector.empty` when the field set is fully param-driven (true for the `passthrough`
reference shape) — this is the "output-contract *summary*" the ticket calls for, not a per-call
resolved schema. Field entries reuse `DataFieldType` (`com.helio.domain.DataFieldType`, declared in
`model.scala` under `package com.helio.domain` — no separate `domain.model` package exists) rather
than inventing a new type vocabulary. *Alternative rejected*: a flat `maxRows: Option[Int]` — can't
express "bounded by a param whose value isn't known until expand-time" or "one-per-bucket" without
collapsing distinct guarantees into the same `None`.

**`OutputFieldContract` carries no `role` field.** `OutputFieldContract(name: String, dataType:
DataFieldType, nullable: Boolean)` — three fields only. **Revised after design-gate round 2 REFUTE**
(skeptic-design-2.md): an earlier draft added a `role: String` field with no defined vocabulary, no
precedent anywhere in the codebase, and no consumer — this ticket's own `passthrough` reference shape
never populates it (`fields = Vector.empty`). An unspecified, untested, unenforced field in the one
contract the whole epic is meant to pin is worse than no field: it invites each of the 4 sibling shape
tickets to fill it in ad-hoc with no shared meaning. Dropped for YAGNI — nothing in this ticket's ACs
requires field-role semantics. A future ticket that has a real, load-bearing need for a semantic role
(e.g. "which field is the time axis" for HEL-396) can add it then, with a defined vocabulary (ideally a
sealed type, not a bare `String`) driven by that concrete need, and a reference shape/test that
actually exercises it.

**3. `paramsSchema` is `Vector[ShapeParamDescriptor]` (name/label/dataType/required/description) —
descriptive metadata for the catalog, not a validating JSON Schema document.** Mirrors
`ConnectorFieldDescriptor`'s role (tells a caller what's needed before it builds a request) rather than
introducing a JSON-Schema-2020-12 validator dependency. Actual validation happens inside `expand`
itself (tolerant decode of `params: JsObject` into a typed case class, `Left(msg)` on missing/invalid
required fields) — same division of labor as `PipelineStepConfigCodec` (typed decode) vs.
`ConnectorFieldDescriptor` (descriptive only, "descriptors only, never values").

**4. Registry mirrors `PipelineStep.Registry`'s `Companion`-map pattern, not `ConnectorRegistry`'s flat
`Vector`.** `PipelineShape.Registry: Map[String, PipelineShape]` keyed by `id`, with `shapeFor(id)`
returning `Either[String, PipelineShape]` (same error shape as `PipelineStep.companionFor`). Chosen
over a flat `Vector` (`ConnectorRegistry.all`) because shape lookup-by-id is a named requirement (AC1:
"registry lookup") the way connector lookup-by-kind never was a first-class connector-registry
operation. A parity test (mirroring `ConnectorRegistrySpec`) is deferred until >1 shape exists — with
exactly one registered shape there's nothing to drift against yet; the sibling tickets each add one
`Registry` line the same way `PipelineStep.Registry` gains a line per new step kind.

**5. Catalog endpoint gets a real (if thin) service — `PipelineShapeService.catalog(): Vector[PipelineShapeCatalogEntry]`
— per the ticket's explicit "logic in a service" instruction, unlike `ConnectorRoutes` (no service,
ticket predates this instruction).** Route stays a pure HTTP shell (`PipelineShapeRoutes`, same
structure as `ConnectorRoutes`); the service does the `PipelineShape.Registry.values → CatalogEntry`
projection so a later ticket (e.g. HEL-400's MCP tool) can call the service directly without an HTTP
round-trip, matching `SourceService`/`PipelineService`'s existing reuse pattern.

**6. Route path is `GET /api/pipeline-shapes`** — a distinct top-level prefix, NOT nested under
`pipelines`. **Revised after design-gate round 1 REFUTE** (skeptic-design-1.md): `PipelineRoutes.scala`
mounts `path(PipelineIdSegment)` directly under `pathPrefix("pipelines")`
(`PipelineRoutes.scala:42-56`), and `PipelineIdSegment` (`IdParsing.scala`) is an unvalidated
`Segment.map(PipelineId(_))` matcher — it syntactically matches *any* single literal segment, including
the literal string `"shapes"`. Since `ApiRoutes.scala` mounts `PipelineRoutes` in the same top-level
`concat`, and Pekko's `concat` commits to the first route whose path structurally matches (not the
first that semantically succeeds), nesting a `shapes` route "alongside" `PipelineRoutes` under
`/api/pipelines/...` would have `GET /api/pipelines/shapes` swallowed by `PipelineRoutes`'s
pipeline-by-id branch (`findSummaryById(PipelineId("shapes"), user)` → not-found) before ever reaching
the shapes catalog route — an order-dependent landmine, confirmed by re-reading `PipelineRoutes.scala`
and `ApiRoutes.scala`'s mount order. A distinct top-level prefix sidesteps the collision entirely and
isn't order-dependent; it also matches the *existing* `pipeline-steps` sibling-prefix convention
(`PipelineStepRoutes.scala` already mounts a second top-level `pathPrefix("pipeline-steps" /
PipelineStepIdSegment)` for exactly the same "not `pipelines/:id/...`" reason). `PipelineShapeRoutes`
is mounted in `ApiRoutes.scala` as its own top-level entry (order relative to `PipelineRoutes` doesn't
matter), authenticated identically (`authenticatedUser` in scope, no per-user filtering — the registry
is global, same as `ConnectorRoutes`). *Alternative rejected*: keep `/api/pipelines/shapes` and pin a
mount-before-`PipelineRoutes` ordering requirement — works but documents around a footgun instead of
removing it, and is fragile to a future `ApiRoutes.scala` reorder.

**7. Reference shape: `passthrough`.** Params: `fields: Vector[String]` (required, non-empty).
Expands to exactly one `select` step (`SelectConfig(fields)`) — reuses the existing, simplest step
kind. `outputContract = OutputContract(RowCountContract.Unbounded, fields = Vector.empty, description =
"Passes source rows through, narrowed to the selected fields")`. Chosen over touching any op associated
with a sibling shape's likely design (aggregate/pivot/window) so this ticket doesn't presume or
foreclose HEL-393/394/396/398's decisions.

## Risks / Trade-offs

- **[Risk]** `RowCountContract`'s 3 cases might not fit a sibling shape's real contract once designed →
  **Mitigation**: it's a plain ADT in a foundation package all 4 sibling tickets will read before
  designing; adding a 4th case is a small, additive, non-breaking change (not sealed outside this file
  — sibling tickets can propose an addition here if genuinely needed).
- **[Risk]** No registry-parity test yet (Decision 4) means a future shape could be added without a
  `Registry` line and silently not appear in the catalog → **Mitigation**: `expand`/`outputContract` are
  abstract on the trait, so an unregistered shape simply doesn't compile into anything reachable; the
  parity-test pattern is documented here for the second shape's ticket to add once there's a real set
  to assert against.
- **[Risk]** `ShapeStepExpansion` duplicating `CreatePipelineStepRequest`'s shape could drift →
  **Mitigation**: both are two-field structural mirrors of the same `type`/`config` wire concept; a
  test asserts the field-for-field mapping compiles and round-trips through `PipelineStepConfigCodec.decode`.
- **[Risk]** A route-object-in-isolation test (the established `ConnectorRoutesSpec` pattern) would not
  have caught the `/api/pipelines/shapes` routing collision resolved in Decision 6 — it never exercises
  `ApiRoutes.scala`'s real mounted composition → **Mitigation**: Decision 6 removes the collision at the
  root (distinct top-level prefix, not order-dependent), and tasks.md 5.4 additionally requires a test
  that drives the request through the fully composed `ApiRoutes` tree (not just the isolated
  `PipelineShapeRoutes` object), so any *future* mounting mistake for this or a sibling route is still
  caught even though this specific collision no longer exists.

## Planner Notes

- Self-approved: no Flyway migration (purely code-level registry, per ticket + `ConnectorRegistry` precedent).
- Self-approved: `passthrough` reference shape's exact param/expansion choice (Decision 7) — trivial,
  reuses existing `SelectStep`, doesn't touch any op a sibling shape ticket is likely to need first.
- Self-approved: route path `/api/pipeline-shapes` (revised from the ticket's "e.g." suggested
  `/api/pipelines/shapes` after design-gate round 1 — see Decision 6) — the ticket's path was
  explicitly an example ("e.g."), and the revision follows the codebase's own existing
  `pipeline-steps` sibling-prefix convention.
