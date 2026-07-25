## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-shape-registry/spec.md` in full.
- `openspec validate shape-abstraction-registry --strict` → `Change 'shape-abstraction-registry' is valid`.
- Confirmed `PipelineStep.Registry`'s actual shape at
  `backend/src/main/scala/com/helio/domain/PipelineStep.scala:100-125` — a
  `Map[String, Companion]` keyed by kind string, with `companionFor(kind): Either[String, Companion]`
  (lines 128-135). Design.md's Decision 4 (`PipelineShape.Registry: Map[String, PipelineShape]` +
  `shapeFor(id)`) is an accurate structural mirror. (Note: the ticket's file path
  `backend/.../domain/steps/PipelineStep.scala` is slightly off — the real file is
  `domain/PipelineStep.scala`, with per-kind files under `domain/steps/`. This is a ticket-context
  inaccuracy, not a design.md claim, and doesn't affect soundness.)
- Confirmed `ConnectorRegistry` (`backend/src/main/scala/com/helio/domain/ConnectorRegistry.scala`)
  is a flat `Vector[ConnectorMetadata]` with no lookup-by-kind method, and `ConnectorRoutes.scala` is
  a DB-free thin shell (`GET /api/connectors` → `ConnectorRegistry.all.map(ConnectorMetadataResponse.fromDomain)`).
  Design.md's characterization of both (flat Vector, no service, precedent for a catalog endpoint) is accurate.
- Confirmed `DataFieldType` (`backend/src/main/scala/com/helio/domain/model.scala:229-242`) and
  `InferredField`/`DataField` shapes — `OutputFieldContract(name, dataType: DataFieldType, nullable, role)`
  is a reasonable structural reuse, consistent with existing `InferredField`/`DataField`.
- Confirmed `DataType(id, sourceId, name, fields: Vector[DataField], ..., version, ...)` — panels
  actually bind through `Pipeline.outputDataTypeId` → `DataType.fields`, not through anything shape-level.
  `OutputContract` as designed is a catalog-time *summary* (not a resolved/enforced schema), which
  matches design.md's own framing and doesn't conflict with how binding actually works today.
- Confirmed `SelectConfig.decode` (`backend/src/main/scala/com/helio/domain/steps/SelectStep.scala:14-23`)
  is tolerant (missing `fields` key defaults to `Vector.empty` rather than failing). This means the
  planned AC3 cross-check test (5.3) — mapping `ShapeStepExpansion` → `CreatePipelineStepRequest` →
  `PipelineStepConfigCodec.decode` — will pass trivially for `passthrough` regardless of subtle key-name
  bugs in the mapping, since `select`'s decode never fails. Non-blocking (matches the ticket's literal
  AC wording; a stricter step kind in a sibling ticket would exercise this harder), but worth naming.
- Constructed all 4 known sibling shapes mentally against the `expand(params): Either[String, Vector[ShapeStepExpansion]]`
  contract using the existing step-op vocabulary confirmed in `PipelineStep.Registry`
  (`sort`/`limit`/`aggregate`/`dateBucket`/`pivot`/`select`, all present, `PipelineStep.scala:102-125`):
  single-row → `aggregate`(no group) or `sort`+`limit(1)`, `rowCount = ExactlyOne`; top-N → `sort`+`limit(n)`,
  `rowCount = AtMostParam("n")`; time-series → `dateBucket`+`aggregate`+`sort`, `rowCount = Unbounded`;
  pivot/matrix → `aggregate`+`pivot`, `rowCount = Unbounded`. All four are expressible as a
  `Vector[ShapeStepExpansion]` built purely from caller-supplied params (no repo/network access needed).
  I could not construct a case that breaks the contract.
- **Routing-collision check (the finding driving the REFUTE)**: confirmed
  `IdParsing.PipelineIdSegment = Segment.map(PipelineId(_))` — an unvalidated, format-free single-segment
  matcher (`backend/src/main/scala/com/helio/api/protocols/IdParsing.scala:19`). Confirmed
  `PipelineRoutes.scala:38-52` mounts `path(PipelineIdSegment) { pipelineId => concat(get { ServiceResponse.run(pipelineService.findSummaryById(...)) }, patch {...}, delete {...}) }`
  directly under `pathPrefix("pipelines")` — i.e. any single literal path segment under `/api/pipelines/*`
  (including the literal string `"shapes"`) syntactically matches this route as a pipeline id. Confirmed
  `ServiceResponse.run` (`backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:31-38`) always
  `complete`s the response (200 or an error status via `completeError`) and never `reject`s on `Left`.
  Confirmed the current `ApiRoutes.scala` mounts `new PipelineRoutes(...).routes` (line 269) *before*
  `new PipelineStepRoutes(...).routes` (line 270) in the top-level `concat(...)` (lines 186-278) — the
  exact spot design.md Decision 6 / tasks.md 3.4 tell the implementer to mount `PipelineShapeRoutes`
  "alongside `PipelineRoutes`/`PipelineStepRoutes`". Since Pekko's `concat` commits to the first route
  whose path *syntactically* matches (not the first that semantically succeeds), and `path(PipelineIdSegment)`
  matches any literal segment including `"shapes"`, mounting `PipelineShapeRoutes` after `PipelineRoutes`
  (the natural reading of "alongside") means `GET /api/pipelines/shapes` will always be swallowed by
  `PipelineRoutes`'s pipeline-by-id branch, calling `findSummaryById(PipelineId("shapes"), user)` and
  completing with a not-found error — the shapes catalog route becomes unreachable. Mounting it *before*
  `PipelineRoutes` in the same `concat` avoids this, but nothing in the design artifacts states this
  ordering requirement, and it's a landmine for any future refactor of `ApiRoutes.scala`'s route list.
- Confirmed the planned test for this (tasks.md 5.4, mirroring spec.md's catalog scenarios) would very
  likely **not catch this bug**: I checked the established precedent test pattern for the closest
  analog, `ConnectorRoutesSpec` (`backend/src/test/scala/com/helio/api/routes/ConnectorRoutesSpec.scala:17-20`),
  which explicitly tests `new ConnectorRoutes(user).routes` in isolation — bypassing `ApiRoutes`'s full
  composed tree entirely — with the file's own doc comment noting "the 401-unauthenticated case is
  covered separately in `ApiRoutesSpec`'s 'Protected routes' suite, which exercises the full
  auth-directive stack this spec deliberately bypasses." I then checked `ApiRoutesSpec.scala`'s
  "Protected routes" suite (line 2730) and confirmed it only asserts 401-without-auth for each route
  (e.g. line 2767-2768 for `/api/connectors`) — it does not assert 200-with-real-content through the
  full composed tree. If `PipelineShapeRoutes`'s test follows this same established pattern (as
  tasks.md's wording — "route test" — suggests it will), it tests the isolated route object and never
  exercises the actual mounted-order collision; the 401 case in `ApiRoutesSpec` returns 401 before any
  route dispatch happens either way (auth wraps the whole authenticated tree), so it also wouldn't
  distinguish a shadowed 404 from a real 401. **As currently scoped, none of tasks 5.1-5.5 would catch
  this collision**, so it could ship silently: all planned tests green, but the real HTTP endpoint
  unreachable — directly undermining AC2 and blocking the 7 sibling tickets (HEL-400/402/393/394/396/398)
  that need a working catalog endpoint to build against.

### Verdict: REFUTE

### Change Requests

1. **Resolve the `/api/pipelines/shapes` routing collision with `PipelineRoutes`'s
   `path(PipelineIdSegment)` catch-all before implementation.** Either:
   (a) pick a route path immune to the collision — e.g. a distinct top-level prefix such as
   `/api/pipeline-shapes` (mirroring the existing `pipeline-steps` sibling-prefix convention already
   used in `PipelineStepRoutes.scala` for exactly this reason — sub/sibling resources that aren't
   `pipelines/:id/...` don't nest under the bare `pipelines` prefix), which sidesteps the shadow
   entirely and isn't order-dependent; or
   (b) keep `/api/pipelines/shapes` but add an explicit, documented requirement (in design.md Decision 6
   and tasks.md 3.4) that `PipelineShapeRoutes` MUST be mounted in `ApiRoutes.scala`'s top-level `concat`
   *before* `PipelineRoutes`, plus a code comment at the mount site explaining why (so a future
   `ApiRoutes.scala` reorder doesn't silently reintroduce the shadow).
   Option (a) is preferable — it removes an ordering footgun rather than documenting around it.
2. **Add a regression test that would actually catch this class of bug.** Task 5.4 as scoped (mirroring
   `ConnectorRoutesSpec`'s isolated-route-object pattern) will not exercise the real mounted order.
   Add at least one test that drives the request through the fully composed `ApiRoutes` tree (the way
   `ApiRoutesSpec`'s other integration-style tests do) and asserts `GET /api/pipelines/shapes` returns
   the catalog (200, non-empty, `passthrough` present) — not a pipeline-not-found error — through the
   real route composition, not just the isolated `PipelineShapeRoutes` object.

### Non-blocking notes

- Field-name framing nit: design.md Decision 1 / spec.md say `ShapeStepExpansion` "carr[ies] the same
  two fields" as `CreatePipelineStepRequest`. The actual field name in `CreatePipelineStepRequest` is
  `` `type` `` (backtick-quoted keyword, `PipelineStepProtocol.scala:138`), not `kind`. The types line
  up positionally so the mapping still works fine — just tighten the wording ("same two-field shape",
  not "identical fields") to avoid an implementer expecting a literal `kind` field to exist on the API DTO.
- The reference-shape cross-check test (AC3 / tasks 5.3) is weak by construction: `SelectConfig.decode`
  is fully tolerant (never fails), so the test proves "decode doesn't throw" but not much about the
  correctness of the `kind`/`config` mapping itself. Acceptable for a foundation ticket per the ticket's
  literal AC wording, but sibling shape tickets using a stricter-decoding step kind will exercise this
  more meaningfully — no action needed now.
- `RowCountContract`'s `AtMostParam(paramName: String)` has no mechanism (test or type) tying `paramName`
  back to an actual entry in the shape's own `paramsSchema` — a shape could declare
  `AtMostParam("nonexistent")` with nothing catching the drift. Not exercised by this ticket's one
  reference shape (`Unbounded`, no param reference), so not blocking here; worth a light consistency
  check (or at least a comment) when the first shape that uses `AtMostParam` lands (HEL-394, top-N).
- Design.md's own Risks section already self-identifies that `RowCountContract`'s 3 cases might not fit
  a sibling shape's real needs and proposes an additive-case mitigation — reasonable and sufficiently
  self-aware; no further action needed at this gate.
