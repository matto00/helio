## Context

`PatchSet`/`Edit`/`EditTarget` (HEL-403, `PatchSetProtocol.scala`) already parse + validate shape
and `target.id` presence for update/delete. Nothing applies them yet. Existing rollback precedent
(`PipelineProposalService.rollback`, `CombinedProposalService`) only ever undoes a CREATE (delete
what was minted this call) — genuinely simpler than this ticket's need, since `update`/`delete`
edits mutate resources that predate this call.

Per-kind service surface, read directly from source before deciding scope (revised after round-1
skeptic REFUTE re-verified every claim below against actual line numbers, not the round-1 prose):
`DataTypeService` has NO `create` method (only `update`/`delete`, `DataTypeService.scala:69,127`)
— a DataType is only ever produced as a side effect of a source/pipeline. `DataSourceService` has
EIGHT `create*` methods (`createStatic`/`createCsv`/`createTextUpload`/`createTextUrl`/
`createPdfUpload`/`createPdfUrl`/`createImageUpload`/`createImageUrl`); TWO more
(`createRest`/`createSql`, not `createRestApi`) live on a SEPARATE class, `SourceService.scala:43,64`.
Several require multipart file bytes (not expressible in a JSON `patch` field at all) or live
external I/O at create time (`createRest`/`createSql`, per HEL-627's own investigation of
`create_rest_data_source`). `PipelineService` composes `create`+`addStep`*+ a run
(`PipelineService.scala:133,433`; `pipelineRunService.submit`) — duplicating that composition
inside rollback would re-implement `PipelineProposalService`'s own job. `PipelineService.addStep`
(`:433`) takes only `pipelineId` — a pipelineStep's `EditTarget` has no field carrying its PARENT
pipeline's id (HEL-403's schema has `{kind, id?}` only), so a not-yet-existing step cannot be
targeted by a create-op edit at all.

**Per-kind real ACL/identity facts** (round-1 REFUTE findings 2/3/4 — verified against the actual
`update`/`delete`/`create` bodies, not the nearest-sounding repo method name):
- `PanelService.create` (`:220`) always mints a fresh `PanelId(UUID.randomUUID)` — no API accepts
  a caller-specified id. `update`/`delete` (`:434-444,274-286`) authorize via
  `panelRepo.findByIdInternal` (no ACL) + `authorizeEditorOnDashboard` → `accessChecker.requireAccess
  ("dashboard", dashboardId, ...)`, editor-or-owner (Viewer → 403) — checked against the PARENT
  DASHBOARD, not a per-panel grant. `DashboardLayoutItem(panelId, x, y, w, h)`
  (`domain/model.scala:282`) references panels by id with no FK/cascade — `delete` never touches
  layout.
- `DashboardService.update` (`:123-142`) uses `dashboardRepo.findById` (sharing-aware): owner
  passes directly; a non-owner grantee goes through `accessChecker.requireAccess`, editor-or-owner
  (Viewer → 403). `create`'s `CreateDashboardInput.ifExists = Some("return")`, matching an existing
  same-name dashboard, returns `(existingDashboard, created = false)` — confirmed by
  `DashboardRoutes.scala:44-48`'s own comment ("nothing was created").
- `PipelineService.updateStep`/`deleteStep` (`:521-620`) use `pipelineStepRepo.findByIdInternal`
  (no ACL) + a PIPELINE-level owner-or-editor check (Viewer → 403) — NOT `findById`, which is
  owner-only by its own doc comment ("Owner-scoped ... parent-pipeline JOIN",
  `PipelineStepRepository.scala:44`). `addStep` (`:506-514`) mints a new step id via
  `insertInternal` — no caller-specified-id path here either.
- `dataSource`/`dataType`/`pipeline`(-level) update/delete are genuinely owner-only
  (`findByIdOwned` on each repo) — checked out correctly in round 1, unchanged here.

## Goals / Non-Goals

**Goals:** atomic apply (all-or-nothing) for the per-kind/per-op matrix below; pre-validation
(existence + ownership + shape) that reuses the SAME access rule each target kind's real
update/delete path enforces (not merely a same-named repo method); honest, non-silent reporting
when a rollback cannot fully restore prior state — including identity loss, not only "nothing
restored"; reuse of existing per-resource services exclusively (zero direct repository writes,
zero duplicated business logic); backward-compatible by construction (ticket.md AC) — this ticket
adds exactly one new route (`POST /api/patch-sets/apply`), one new service, and one behavior
tightening to `PatchSetProtocol.scala`'s `Edit.read` (D6, a stricter reader accepting a subset of
what it previously silently accepted — never a wire-format break); no existing PATCH/DELETE route,
request shape, or response shape is modified.

**Non-Goals:** see proposal.md. Additionally: no attempt to make every kind/op combination
rollback-symmetric where doing so would either be impossible (no create API), require a
caller-specified id no existing API supports (panel, pipelineStep), or duplicate an existing
service's own multi-step composition (dashboard-with-panels, pipeline-with-steps-and-run,
dataSource's ten create variants) — documented as a real limit, not silently glossed over. No
idempotent get-or-create semantics for a dashboard create-op edit (`ifExists` rejected, not
honored) — this ticket never needs it and it breaks rollback symmetry (see D3a).

## Decisions

**D1 — Per-kind/per-op support matrix** (the central decision; every other choice follows from
this; delete-rollback column revised post-REFUTE — see D3a):

| kind | create | update | delete rollback |
|---|---|---|---|
| panel | ✓ `CreatePanelRequest` | ✓ | ◐ recreated, NEW id (content restored; dashboard layout entry for the old id is NOT repointed — D3a) |
| dashboard | ✓ `CreateDashboardRequest` (name only; `ifExists` rejected pre-validation — D3a) | ✓ | ✗ unrecoverable (cascades to panels; recreate would duplicate `DashboardProposalService`'s composition) |
| dataSource | ✓ `static` only (`createStatic` — pure JSON, no I/O; the other 9 create variants across `DataSourceService`/`SourceService` need file bytes or live I/O, deferred) | ✓ | ✗ unrecoverable (cascades to pipelines; 10 heterogeneous create paths) |
| dataType | ✗ rejected pre-validation (no create API exists) | ✓ | ✗ unrecoverable (no create API to restore via — hard constraint, not a choice) |
| pipeline | ✓ `CreatePipelineRequest` (empty pipeline, no steps — adding steps needs a cross-edit id reference this ticket's schema doesn't support) | ✓ (rename only, matches `UpdatePipelineRequest`) | ✗ unrecoverable (cascades to steps/runs; recreate+re-run would duplicate `PipelineProposalService`) |
| pipelineStep | ✗ rejected pre-validation (no parent-pipeline id field on `EditTarget`) | ✓ | ◐ recreated, NEW id (`addStep` then `updateStep(position=...)` if it landed elsewhere) |

"✗ unrecoverable" and "◐ recreated" delete-rollback are never silent: `PatchSetApplyResponse`
names every edit whose rollback could not fully restore prior state, and for "◐ recreated" also
reports the new id (D4), even though pre-apply validation still lets such a delete execute (the
caller may not need the atomicity guarantee for that specific edit).

**D2 — Pre-validation pass, before any mutation, using each kind's REAL per-OP access rule (not
the nearest-sounding repo method name, and — round-2 REFUTE finding 1 — not assumed uniform
across update/delete just because it happens to be uniform for panel and pipelineStep):**
- panel: `panelRepo.findByIdInternal(id)` (existence + get `dashboardId`), then
  `accessChecker.requireAccess("dashboard", dashboardId, Some(user), ...)`, editor-or-owner
  required — matches `authorizeEditorOnDashboard` exactly, IDENTICAL for `update` and `delete`
  (confirmed both call sites use it, `PanelService.scala:274-287,434-473`).
- dashboard `update`: `dashboardRepo.findById(id, Some(user))` (sharing-aware); owner passes
  directly; non-owner goes through `accessChecker.requireAccess`, editor-or-owner required —
  matches `DashboardService.update`'s own branching exactly.
- dashboard `delete`: a DIFFERENT, owner-only rule — `dashboardRepo.findById(id, Some(user))`
  (sharing-aware, so a no-grant caller still gets 404 not a leaked 403), then a direct
  `ownerId == user.id` check, `Forbidden` otherwise — matches `DashboardService.delete`
  (`DashboardService.scala:86-96`) exactly, which does NOT go through `accessChecker` at all.
  Dashboard is the one kind whose update/delete access rules genuinely diverge; panel and
  pipelineStep do not (confirmed identical for both ops on each).
- pipelineStep: `pipelineStepRepo.findByIdInternal(id)` (existence + get `pipelineId`), then the
  SAME pipeline-level owner-or-editor check `updateStep`/`deleteStep` perform — IDENTICAL for
  `update` and `delete` (confirmed both call sites use it, `PipelineService.scala:521-623,
  626-649`).
- dataSource/dataType/pipeline(-level): `findByIdOwned` (owner-only) — unchanged, confirmed
  correct, identical for update/delete on all three.

`AccessChecker` (`services/AccessChecker.scala`) is a shared, constructor-injectable component
already used by every service above — `PatchSetApplyService` takes the same instance, never
reimplements per-service ACL logic.

For `create`: decode `createPatch` (HEL-403's raw `JsValue`) into the matching typed
`Create*Request` — a decode failure is the "shape invalid" case AC2 names. A dashboard-create
edit whose decoded `CreateDashboardRequest.ifExists` is `Some(...)` is REJECTED here (D3a) — this
ticket only ever wants `create = true` semantics. Nothing is applied until every edit passes.

**D2a — Embedded cross-resource references also get pre-validated (round-3 REFUTE finding, fixed
per explicit human direction — `implement-full-fix`, not the "document as limitation" alternative
the skeptic also offered).** `EditTarget`/top-level id is not the only ownership-gated reference an
edit can carry — several real create/update paths ALSO authorize a resource named INSIDE the
decoded patch, and pre-validation must run the SAME check, using the SAME already-injected
components (`accessChecker`, `dataSourceRepo`, `dataTypeRepo`, `metricRepo` — no new dependency):
- panel `create`: the decoded `CreatePanelRequest.dashboardId` is authorized via
  `accessChecker.requireAccess("dashboard", dashboardId, Some(user), ...)`, editor-or-owner —
  mirrors `PanelService.create`'s own check (`PanelService.scala:176`) exactly, run here instead
  of only at forward-apply time.
- pipeline `create`: the decoded `CreatePipelineRequest.sourceDataSourceId` is authorized via
  `dataSourceRepo.findByIdOwned(sourceDataSourceId, user)` (owner-only) — mirrors
  `PipelineRepository.create`'s own check (`PipelineRepository.scala:212`) exactly.
- panel `update`/`create`: when the decoded config patch carries a `dataTypeId` and/or `metricId`,
  pre-validation runs the SAME two checks `PanelService` runs — `rejectCompanionBinding`
  (`dataTypeRepo.findByIdOwned`, rejects a companion, non-pipeline-output binding) and
  `rejectUnresolvableMetric` (`metricRepo.findByIdOwned`, rejects a foreign/unresolvable metric) —
  mirroring `PanelService.scala:483-524` exactly, not reimplemented, just invoked earlier.
- pipelineStep `update`: when the decoded config patch is a `JoinConfig`/`UnionConfig`/
  `LookupConfig`, pre-validation runs the SAME "Pre-flight ACL" checks
  `PipelineService.updateStep`/`addStep` already run — `dataSourceRepo.findByIdOwned` on
  `rightDataSourceId`/`otherDataSourceId`/`referenceDataSourceId` respectively
  (`PipelineService.scala:448,457,469,568-597`) — mirrored, not reimplemented.

A failure in any of these is reported exactly like a top-level target failure (404/400, matching
the real service's own error) — pre-validation as a whole still fails before any edit in the set
is applied.

**D3 — Rollback mechanics: prior-state capture, not a DB transaction spanning the services (ticket.md
Scope's own named alternative — round-7 REFUTE finding: the choice was made and followed
throughout, but never explicitly justified against the alternative it names).** A single
transaction spanning `PanelService.update` + `DashboardService.update` + a HEL-328 service call
etc. is not available without invasive changes to every one of those services: `DbContext.
withUserContext`/`withSystemContext` (`DbContext.scala:50-64`) each independently `db.run(...)
.transactionally` — open AND commit their own transaction per call, with no mechanism for an
external caller to hand in an already-open session/transaction for a DIFFERENT service's repository
call to join. Making that possible would mean either (a) threading a transaction handle through
every per-resource service's public API (a real, invasive signature change to services this ticket
is required to reuse UNMODIFIED — "applies via existing per-resource services... no duplicated
mutation logic," ticket.md AC3), or (b) a raw multi-repository transaction bypassing those services
entirely (violating that same AC directly: "no direct DB writes"). Prior-state capture, by
contrast, needs no changes to any existing service — it is what makes "reuse existing services
verbatim" and "atomic across independent per-resource transactions" simultaneously possible. This
is the SAME kind of alternative-considered-and-rejected reasoning D3a below already gives for
declining to also repoint dashboard layout on panel-delete-rollback — applied here to the
ticket's own explicitly-named top-level design choice, not left implicit.

Applied edits are tracked as they succeed (in caller order). On any
failure, walk that success list BACKWARD, compensating each: `create` → delete via the same kind's
existing delete method (mirrors `PipelineProposalService.rollback`'s established shape exactly);
`update` → capture the pre-mutation full state (already read during D2's pre-validation pass — no
second read) and reapply it as a full-overwrite inverse `Update*Request` (every field populated,
not just the ones the forward edit changed) through the SAME service method; `delete` → per D1's
matrix, either recreate (panel/pipelineStep, D3a) or marked unrecoverable in the response. A
rollback step itself failing is logged and the affected edit is ALSO reported unrecoverable —
rollback never throws past the original failure.

**D3a — Identity loss on recreate, and the dashboard `ifExists` fix (round-1 REFUTE findings 2/3).**
Neither `PanelService.create` nor `PipelineService.addStep` accepts a caller-specified id — a
rolled-back panel/pipelineStep delete restores CONTENT under a NEW id, never the original. For
panel specifically, the dashboard's `layout` JSONB entry for the OLD id is not touched by
`PanelService.delete` and is NOT repointed to the new id by this rollback (extending the
compensation to also patch `layout` was considered and rejected: it would require capturing and
restoring layout as a THIRD kind of compensating state per panel-delete-rollback, on top of the
panel's own content, meaningfully expanding this ticket's scope for a v1 whose Tests section names
only content-preservation, not layout-preservation, as the bar). `EditOutcome` (D4) carries an
optional `newId` so a caller can learn the new id and re-point layout itself if it cares.
`DashboardService.create`'s `ifExists: "return"` path can return a PRE-EXISTING dashboard with
`created = false` — the create→delete rollback compensation has no way to distinguish that from a
real create, and deleting a dashboard that predates the patch set would be data loss, not an undo.
Fixed by rejecting `ifExists` outright at pre-validation (D2) rather than tracking `created` through
rollback — simpler, and this ticket never needs idempotent-return semantics.

**D4 — Response shape.** `PatchSetApplyResponse{ edits: [EditOutcome{index, status: applied|
rolledBack|recreated|unrecoverable, newId: Option[String], priorState: Option[JsValue],
resultingState: Option[JsValue]}], failure: Option[String] }` — new types in
`PatchSetApplyProtocol.scala` + `schemas/patch-set-apply-response.schema.json`, additive, no
existing response shape touched. `recreated` is distinct from `rolledBack` (an `update`/`create`
undo restores the ORIGINAL id; `recreated` — panel/pipelineStep delete-rollback only — does not).

**D4a — Prior-state emission (ticket.md Scope: "Emit the captured prior-state set so the undo
ticket can consume it (shared shape)"; AC "Prior-state capture is emitted in a shape the undo
ticket can consume" — round-5 REFUTE finding: an explicitly-named AC with zero coverage anywhere
in this document before this decision).** `priorState` on `EditOutcome` carries the SAME
pre-mutation full state D2/D3 already read into memory for `update`/`delete` edits — serialized
using each kind's EXISTING response shape/format, never a new one invented for this ticket:
`PanelResponse`, `DashboardResponse`, `DataSourceResponse`, `DataTypeResponse` (each has a
`fromDomain` factory taking exactly the bare domain object D2's pre-validation already reads — no
second read for these five kinds), and `PipelineStepResponse`. `pipeline` is the ONE documented
exception (round-6 REFUTE finding): `PipelineSummaryResponse` needs the JOINED
`PipelineRepository.PipelineSummary` DTO (`sourceDataSourceName`/`outputDataTypeName`/
`lastRunRowCount`, `PipelineRepository.scala:378-389`), which `findByIdOwned` (D2's pipeline ACL
read, returns a bare `Pipeline` — ids only) does NOT provide — capturing pipeline `priorState`
genuinely requires the separate joined query (`findSummaryById`/`findSummaryByIdShared`,
`PipelineRepository.scala:126-149`), a deliberate SECOND read for this one kind only, made
explicitly rather than silently assumed away. This is the literal "shared shape" the ticket asks
for — a future undo ticket (out of THIS ticket's scope to build, per Non-Goals) reads the exact
same JSON shape any other caller of that resource kind's read endpoint already gets, not a bespoke
undo-only format. `create`-op edits carry `priorState = None` (nothing existed before a create).
Populated independent of an edit's final `status` — even an `unrecoverable` delete's `priorState`
is real, useful data for a future undo attempt to work from, which is exactly why capturing it
(not just internal same-call rollback) matters for the four kinds D1 marks
delete-rollback-unrecoverable.

**D4b — Resulting-state emission (ticket.md Scope: "`POST /api/patch-sets/apply` returning the
per-edit outcome + the resulting resource states" — round-6 REFUTE finding, distinct from D4a's
BEFORE-state AC: this clause was never addressed at all, and `newId` alone — documented only for
the recreate-rollback case — doesn't cover it for an ordinary successful `create`/`update`).**
`resultingState` on `EditOutcome`, mirroring `priorState`'s exact reuse pattern (same six response
shapes, same pipeline caveat — D4a), carries the POST-mutation full state for `create`/`update`
edits, and for a `recreated` delete-rollback (the newly-recreated resource, superseding the need
to read `newId` separately, though `newId` is kept too since D1/D3a/spec.md already established it
across prior rounds and it remains a convenient quick-access field). `None` for a plain `delete`
(nothing remains) and for an `unrecoverable` rollback (nothing was restored to report). Every
`create`'s domain object is already returned by that kind's own service call at forward-apply time
(`PanelService.create` → `Future[Either[ServiceError, Panel]]`, etc.) — no extra read beyond what
D1's forward-apply already performs.

**D5 — Route.** `POST /api/patch-sets/apply` (`PatchSetRoutes.scala`, mirrors
`CombinedProposalRoutes.scala`'s thin-shell style — `ServiceResponse.run` maps
`Either[ServiceError, PatchSetApplyResponse]`), wired into `ApiRoutes.scala`'s existing route
composition.

**D6 — HEL-403's carried-over follow-up (delete-op `patch` field) — fixed at the layer that
actually has the signal (round-1 REFUTE finding 1).** `PatchSetProtocol.scala`'s `Edit.read`
(`:82-134`) currently discards the raw `"patch"` value entirely for `op == "delete"` BEFORE the
`Edit` case class is constructed — by the time `PatchSetApplyService` sees a `PatchSet`, there is
no signal left to reject on. Fixed in `PatchSetProtocol.scala` itself (added to this ticket's
Impact, per the round-1 change request): `Edit.read` raises a `deserializationError` when
`op == "delete"` and the wire JSON's `"patch"` key is present, mirroring its EXISTING enforcement
of `target.id` for update/delete — the same file, the same reader, the same error style, not a
new mechanism. This is a MODIFIED requirement on the ALREADY-ARCHIVED `patch-set-contract`
capability (HEL-403) — see the spec delta.

## Risks / Trade-offs

- **Panel/pipelineStep delete-rollback loses identity** (D3a) → mitigated by D4's `newId`
  reporting; downgraded from "full" to "recreated" in D1 rather than overclaiming symmetry.
- **Four kinds have no delete-rollback guarantee at all** (D1) → mitigated by D4's honest
  `unrecoverable` reporting; this is the ticket's own requested "document the rollback approach
  and its limits," not an omission.
- **Pre-validation reads add one extra DB round-trip per edit** vs. relying on each service's own
  internal check → accepted: the alternative (validate-as-you-go) violates AC2's literal
  "nothing changes if anything is invalid" requirement.
- **Rollback-of-rollback** (a compensating action itself fails) → D3's "mark unrecoverable,
  never throw past the original failure" bounds this; no retry loop, no infinite recursion.
- **D2/D2a's ACL replication risk**: reusing `AccessChecker`/repo lookups directly (rather than
  each service's own update/delete method) means a FUTURE change to a service's ACL branching
  (e.g. a new grantee tier, or a new embedded reference a service starts checking) could silently
  drift from `PatchSetApplyService`'s copy → no new mitigation beyond stating this plainly; the
  alternative (calling the real service method twice, once to validate and once to apply) would
  double every mutation's side effects, which is worse. Rounds 2 and 3 each sharpened this risk
  concretely and independently: round 2 found dashboard's update/delete rules genuinely diverge;
  round 3 found pre-validation was missing ACL checks on FOUR embedded cross-resource references
  entirely (D2a) — both now fixed, but the underlying replication risk (a service's real ACL
  surface can always grow a check this design doesn't yet know about) remains open-ended by
  nature, not something a finite number of design-gate rounds can prove exhaustively absent.
  Accepted as a standing risk of the "reuse existing components read-only, don't call the real
  mutation twice" approach — not something this ticket can close entirely.

## Planner Notes

Self-approved: no new external dependency, no breaking API change, additive-only surface (the one
`PatchSetProtocol.scala` change is a tightening of an already-existing reader's error handling, not
a wire-format break). Round-1 design-gate REFUTE (see `skeptic-design-1.md`) caught five real,
source-grounded problems — all five addressed (D1 delete-rollback tiers, D2 ACL lookups, D3a
identity-loss + `ifExists`, D6 relocated to `PatchSetProtocol.scala`, Context's method-count fix).
Round-2 REFUTE (see `skeptic-design-2.md`) then caught a sixth, narrower problem the round-1 fix
didn't test: dashboard's delete recipe was assumed identical to its update recipe (true for panel
and pipelineStep, false for dashboard — `DashboardService.delete` is genuinely owner-only,
`DashboardService.update` admits editor grantees) — fixed in D2 above by splitting the dashboard
recipe per-op instead of per-kind, and task 4.1's forward-apply method list was extended to
actually name the four kinds' `delete` methods it was silently presupposing.

Round-3 REFUTE (see `skeptic-design-3.md`) exhausted this run's `SKEPTIC_DESIGN_ROUNDS` (3) budget
on a seventh problem in the same defect family: pre-validation authorized only the top-level
`EditTarget`, never a resource referenced from INSIDE a `patch`/`createPatch` payload (panel-create's
`dashboardId`, pipeline-create's `sourceDataSourceId`, panel-update/create's `dataTypeId`/
`metricId`, pipelineStep-update's Join/Union/Lookup `DataSource` references) — per this document's
own escalation policy, budget exhaustion was surfaced to the human as a `budget`-kind escalation
rather than attempting a fourth unattended round. The human chose `implement-full-fix` over the
skeptic's own offered "document as a v1 limitation" alternative — applied above as D2a. Design-gate
rounds from here on (round 4+) run following that explicit human direction, not as further
unattended iteration, and are not counted against the exhausted budget.

Round-4 REFUTE (see `skeptic-design-4.md`) caught an eighth problem, this one purely in the
downstream artifacts, not the design decision itself: D2a's own text correctly describes
`rejectCompanionBinding` as rejecting only an OWNED companion-type `dataTypeId` binding (a
foreign-owned/nonexistent one passes through unchanged, per `PanelService`'s own doc comment), but
`tasks.md`/`spec.md`'s scenario text for it had drifted to the wrong ("foreign-owned is rejected")
framing — fixed by correcting that text and adding a separate `metricId` scenario for the
genuinely-foreign-rejecting case `rejectUnresolvableMetric` actually has.

Round-5 REFUTE (see `skeptic-design-5.md`) then caught a ninth, categorically different problem —
not another ACL-lookup gap, but an entire ticket AC with zero coverage: `ticket.md`'s "Emit the
captured prior-state set so the undo ticket can consume it (shared shape)" Scope bullet and its
matching AC were never addressed anywhere in this document before D4a above. Fixed by adding
`priorState` to `EditOutcome`, reusing each kind's EXISTING response shape (no new format
invented) — the literal "shared shape" the ticket names.

Round-6 REFUTE (see `skeptic-design-6.md`) found two more problems on a fresh full pass: (a) D4a's
"no second read" claim was false for `pipeline` specifically — `PipelineSummaryResponse` needs a
genuinely separate joined query (`PipelineRepository.PipelineSummary`), not the bare `Pipeline`
D2's ACL check reads — fixed by documenting pipeline as an explicit, deliberate second-read
exception rather than leaving the false uniform claim standing; (b) `ticket.md`'s OTHER
resource-state Scope bullet ("returning the per-edit outcome + the resulting resource states") —
distinct from the already-fixed BEFORE-state AC — also had zero coverage, since `newId` alone
(documented only for recreate-rollback) doesn't satisfy it for an ordinary successful create/
update. Fixed by adding `resultingState` (D4b), mirroring `priorState`'s exact reuse pattern.
This continues to be reviewed with full rigor each round despite the escalation, per the human's
own direction to "continue the run" — not treated as pre-approved once a human weighed in on round
3's original finding.

Round-7 REFUTE (see `skeptic-design-7.md`) found one more, narrower gap in the same "ticket.md
clause never explicitly addressed" category: the Atomicity+rollback Scope bullet names TWO
candidate rollback approaches ("prior-state capture vs a DB transaction spanning the services")
and asks for both the chosen approach AND its limits to be documented — this design always
documented the chosen approach thoroughly but never explained why the OTHER named alternative was
rejected. Fixed by grounding that rejection in `DbContext.scala`'s actual transaction-per-call
behavior (D3, added above) — the same alternative-considered-and-rejected reasoning this document
already models elsewhere (D3a), now applied to the ticket's own top-level named choice.
