## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `skeptic-design-1.md` in full (the round-1 REFUTE) as a claim to re-verify, not as fact.
- Read the revised `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-shape-registry/spec.md`,
  and `ticket.md` in full.

**1. Routing-collision fix (round-1's blocking finding) — re-verified sound.**
- Re-confirmed `PipelineIdSegment = Segment.map(PipelineId(_))`
  (`backend/src/main/scala/com/helio/api/protocols/IdParsing.scala:19`) and `PipelineRoutes.scala:42`
  still mounts `path(PipelineIdSegment)` directly under `pathPrefix("pipelines")` — the collision
  design.md Decision 6 describes is real and still present in the codebase.
- Confirmed the fix: `design.md` Decision 6 / `tasks.md` 3.3 / `spec.md`'s new "GET /api/pipeline-shapes"
  requirement now specify a **distinct top-level route prefix**, `/api/pipeline-shapes`, not nested
  under `pipelines` at all. Since Pekko's `pathPrefix("pipelines")` only matches when the first segment
  is the literal string `"pipelines"`, and `"pipeline-shapes"` is a different literal string, this
  sidesteps `PipelineRoutes`'s `path(PipelineIdSegment)` branch entirely — not order-dependent.
- Read the **entire** authenticated top-level `concat(...)` in `ApiRoutes.scala:194-281` and, for every
  one of the 21 currently-mounted route classes, grepped each route file's own `pathPrefix`/`path`
  declarations (`DashboardProposalRoutes`, `DashboardRoutes`, `DashboardSnapshotRoutes`, `PanelRoutes`,
  `PermissionRoutes`, `DataTypeRoutes`, `DataSourceRoutes`, `DataSourcePreviewRoutes`, `SourceRoutes`,
  `SourcePreviewRoutes`, `ConnectorRoutes`, `PipelineRoutes`, `PipelineStepRoutes`,
  `PipelineRunSubmitRoutes`, `PipelineRunStatusRoutes`, `PipelineRunHistoryRoutes`,
  `PipelineRunStreamRoutes`, `PipelinePermissionRoutes`, `ApiTokenRoutes`, `UploadRoutes`,
  `AlertRuleRoutes`, `AlertEventRoutes`, `PipelineScheduleRoutes`). Every one of them anchors on a fixed
  literal `pathPrefix` (`"dashboards"`, `"panels"`, `"types"`, `"data-sources"`, `"sources"`,
  `"connectors"`, `"pipelines"`, `"tokens"`, `"uploads"`, `"alert-rules"`, `"alerts"`) — none is a bare
  top-level `Segment`/`path(Segment)` catch-all that could swallow the literal `"pipeline-shapes"`.
  **No other mounted prefix would swallow `/api/pipeline-shapes`.** Claim verified.

**2. `pipeline-steps` sibling-prefix precedent — verified accurate.**
- Read `PipelineStepRoutes.scala` in full. It genuinely mounts two siblings inside one `concat`:
  `pathPrefix("pipelines" / PipelineIdSegment / "steps") { ... }` **and**
  `pathPrefix("pipeline-steps" / PipelineStepIdSegment) { ... }` (lines 19, 39) — a real, existing
  second top-level prefix for exactly the "not `pipelines/:id/...`" reason design.md cites. The
  precedent claim is accurate, not fabricated.

**3. Tasks.md 5.4 composition-level test — specific and actionable, with a real precedent to follow.**
- Read `ApiRoutesSpec.scala`'s "Protected routes" suite (`:2730+`) — confirmed round-1's finding that
  the *401* assertions there never exercise real 200 content. But I also found the suite contains
  genuine full-content integration tests through the composed tree, e.g. `"POST /api/dashboards with
  valid token sets createdBy to the authenticated user ID"` (`:2773`) and the chained
  dashboard→panel test (`:2780`), which call `routes()` (the fully composed `ApiRoutes`, not an
  isolated route object) and assert real response content via `responseAs[...]`.
- Task 5.4's wording ("mirrors `ApiRoutesSpec`'s integration-style tests", "returns 200 with the real
  catalog content, and 401 when unauthenticated") points an implementer at this exact, already-existing
  pattern rather than leaving the test shape to guesswork. An implementer following task 5.4 literally
  would write a test that fails today (pre-fix) and passes only once the route is actually reachable
  through the composed tree — i.e., it would have caught the round-1 bug. Sufficiently precise.

**4. Fresh contract re-scrutiny (not just the diff) — found one real gap.**
- Verified `SelectConfig`/`SelectStep.Kind` (`SelectStep.scala:11,29`) match Decision 7's `passthrough`
  claims exactly.
- Verified `CreatePipelineStepRequest(`type`: String, config: JsObject)`
  (`PipelineStepProtocol.scala:138`) matches Decision 1's revised, tightened wording ("same two-field
  shape," not "identical fields") — the round-1 non-blocking wording nit is fixed.
- **New finding — `OutputFieldContract.role: String` is an unspecified field with no defined vocabulary
  anywhere in the artifacts.** `design.md` Decision 2, `tasks.md` 1.4, and `spec.md`'s "OutputContract"
  requirement (line 33-36) all declare `OutputFieldContract(name, dataType: DataFieldType, nullable,
  role: String)`, but nowhere — not in the ticket, not in design.md's prose, not in any spec.md
  scenario — is `role`'s purpose, allowed values, or intended consumer stated. I grepped the entire
  backend and frontend for a "field role" precedent: the only existing `role` concept in the codebase is
  user-permission role (`"viewer"`/`"editor"`, `PermissionProtocol.scala:9-10`,
  `AclDirective.scala:91`) — completely unrelated to a data field's semantic role in an output contract.
  The closest loose analog is `chartTypeOptions.ts:102`'s informal "category axis / value axis" swap
  comment on the frontend, which design.md never references or ties to `role`. Compounding this: the
  ticket's own `passthrough` reference shape sets `fields = Vector.empty`
  (Decision 7, `tasks.md` 2.1, `spec.md` "A shape with param-driven fields declares an empty fields
  list"), so **`role` is never populated or exercised by anything this ticket ships or tests** — no test
  in tasks 5.1-5.5 would catch a wrong, missing, or differently-guessed `role` vocabulary. This directly
  contradicts the ticket's own orchestrator note: *"Get the output-contract concept right — it's what
  panels bind to... The design gate should scrutinize the CONTRACT hardest since this is a greenfield
  abstraction that everything else builds on."* An unspecified field in the one part of the contract the
  ticket itself flags as highest-priority, left for each of the 4 sibling shape tickets (393/394/396/398)
  to independently guess at, is exactly the "expensive to unwind across eight tickets" risk the proposal
  opens by warning against.
- Re-verified `DataFieldType`'s actual location: `package com.helio.domain` (declared at
  `backend/src/main/scala/com/helio/domain/model.scala:1,229` — the file is named `model.scala` but
  there is no `com.helio.domain.model` *package*; confirmed via `find` that no `domain/model` directory
  or `package com.helio.domain.model` declaration exists anywhere). `design.md` Decision 2 states the
  FQN as `com.helio.domain.model.DataFieldType`, which is wrong — the real FQN is
  `com.helio.domain.DataFieldType`. Minor, non-blocking (an implementer would resolve the correct
  import via the actual type regardless; this is a prose/FQN slip, not a structural design error), but
  worth fixing given the project's explicit "no inline FQN" / import-precision culture
  (CONTRIBUTING.md, referenced directly in this ticket's own Scope section).
- Confirmed `PipelineStepConfigCodec.decode(kind: String, raw: String): Try[Any]`
  (`PipelineStepConfigCodec.scala:75`) exists and matches Decision 1 / task 5.3's cross-check-test plan.
- Confirmed no other pathPrefix in `ApiRoutes.scala`'s composed tree would independently collide with
  `/api/pipeline-shapes` (see #1) and that `authenticatedUser` is in scope at the mount site design.md
  Decision 6 / tasks.md 3.4 describe.

### Verdict: REFUTE

### Change Requests

1. **Specify `OutputFieldContract.role: String`'s vocabulary and purpose before implementation**, or
   remove it from this ticket's contract. This ticket's own reference shape never populates `fields`
   (so `role` ships completely untested), and the ticket explicitly calls the output-contract concept
   the part of the design deserving the most scrutiny since it's what panels bind to. Pick one:
   (a) Define a closed vocabulary now (e.g. an enum tied to how HEL-402 panel binding will actually
   consume it — `dimension` / `metric` / `timestamp` / `label`, or whatever the smart-pipelines concept
   doc implies) and add at least a doc-comment or spec.md note stating what each value means and who
   reads it; or
   (b) Drop `role` from `OutputFieldContract` in this ticket (ship `name`/`dataType`/`nullable` only,
   which is fully grounded in the existing `InferredField`/`DataField` precedent and *is* exercised),
   and let the first sibling shape ticket that actually needs a role distinction (likely HEL-393
   single-row or HEL-396 pivot/matrix, which will populate non-empty `fields`) add it with real
   requirements driving its shape. Option (b) is preferable — it removes an unexercised, unspecified
   field from a foundation contract rather than asking 4 sibling tickets to each guess the same thing
   independently.
2. **Fix the `DataFieldType` FQN in design.md Decision 2** — `com.helio.domain.model.DataFieldType` is
   incorrect; the real package is `com.helio.domain` (file `model.scala`, package `com.helio.domain`,
   no `domain.model` package exists). Small fix, but the ticket's own Scope section invokes the
   no-inline-FQN import-precision rule, so the design doc's own FQN claims should be accurate.

### Non-blocking notes

- Round-1's routing-collision finding is resolved at the root (distinct top-level prefix, not an
  ordering convention) — confirmed against the actual mounted route tree, not just the prose claim.
- Round-1's weak-test-plan finding is resolved — tasks.md 5.4 now points at a real, already-existing
  `ApiRoutesSpec` integration-test pattern precise enough that a literal implementation would catch a
  future mounting regression.
- The reference-shape cross-check test (AC3 / task 5.3) remains weak by construction (`SelectConfig`
  decode never fails) — unchanged from round 1's non-blocking note, still acceptable for a foundation
  ticket per the ticket's literal AC wording.
- `RowCountContract.AtMostParam(paramName)` still has no mechanism tying `paramName` back to an actual
  `paramsSchema` entry — unchanged from round 1, still not exercised by this ticket's one reference
  shape (`Unbounded`), still worth a light check when the first `AtMostParam`-using shape (HEL-394)
  lands.
