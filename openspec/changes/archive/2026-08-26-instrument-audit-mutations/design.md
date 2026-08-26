## Context

`AuditService.record(actorUserId, actorTokenId, source, action, resourceType, resourceId, metadata)`
already exists (HEL-471), is constructed in `Main.scala`, and already guarantees it never fails,
blocks, or throws back into the caller. This ticket's only job is to call it, at the right call
sites, with the right arguments. Verified against `origin/main@18e00ba5` (see
`.concertino/runs/HEL-477/evidence/premise-validation.md`): no route or service currently
references `AuditService`.

Mutations flow `Route -> Service -> Repository`. Per the ticket's explicit preference,
instrumentation goes in the **service layer**, one call per operation, so both UI and future
PAT/MCP callers are covered by a single call site rather than duplicated per route.

## Goals / Non-Goals

**Goals:**
- One `AuditService.record(...)` call per state-changing service method (dashboards, panels,
  pipelines incl. step/run submit, data sources, data types) and per auth/token lifecycle event.
- A stable, greppable `action` namespace: `<resource>.<verb>` for CRUD,
  `auth.<verb>[.failed]`/`token.<verb>` for auth/token events.
- Audit write failure is provably invisible to the caller (reuses the HEL-471 contract; verified
  again here with a call-site-level test per the ticket's acceptance criteria, not just at the
  `AuditService` unit level).
- No plaintext secret (password, PAT raw value) in any `metadata` payload.

**Non-Goals:**
- `source`/`actor_token_id` attribution (UI vs PAT vs MCP) — every call site passes
  `AuditSource.Ui` (see Decision 3) and `actorTokenId = None` for now; a later ticket fills these
  in without touching this ticket's call sites' structure.
- Any query API, UI, or read-path instrumentation.
- Changing `AuditService`, `AuditEventRepository`, or the V91 migration/trigger.

## Decisions

**Decision 1 — Instrument at the service layer, one call per public mutation method.**
Each service (`DashboardService`, `DashboardContentsService` if it separately mutates panels,
`PipelineService`/step/run submit paths, `DataSourceService`, `DataTypeRepository`-backed service,
`AuthService`, `ApiTokenService`) takes `auditService: AuditService` as a new constructor
parameter, wired from `Main.scala` alongside its other dependencies. Rejected alternative: a Pekko
HTTP directive wrapping each route — rejected because it can't see the resolved resource id for
`create` (not known until the service call returns) without parsing response bodies, and because
the ticket explicitly asks for single call sites shared by every caller, which a per-route
directive would not provide for a future non-HTTP caller (MCP tool invocation, if it ever bypasses
the route layer).

**Decision 2 — Fire the audit call after the mutation succeeds, never gating the response on it,
generalized per method to what "succeeded" actually means for that method's return type.**
`service.create(...).flatMap { result => auditService.record(...); Future.successful(result) }` —
the audit `Future` is started but not awaited into the response chain (matching `AuditService`'s
own "always completes successfully" contract, so awaiting it would add latency for zero
correctness benefit). "Fire only on success" is not uniformly "the `Right` branch" — each method's
own success signal governs:
- `Future[Either[ServiceError, T]]` methods (the majority — `delete`, `update`, `duplicate`,
  `batchUpdate`, `batchCreate`, `importSnapshot`, `replaceContents`, auth/token methods, etc.): fire
  only on `Right`.
- `DashboardService.create(request, user): Future[(Dashboard, Boolean)]` is the one call site in
  scope that is **not** `Either`-returning — verified at `DashboardService.scala:69-80`. Its second
  tuple element is a `created: Boolean` flag: `false` on the `ifExists = Some("return")` match that
  returns an existing dashboard having inserted nothing (`:72-76`). This call site fires
  `dashboard.create` only when `created == true`; the `(existing, false)` return writes no audit
  row at all (nothing happened to audit). `specs/audit-mutation-instrumentation/spec.md` states
  this as its own scenario.
A failed/no-op mutation never claims to have happened, regardless of which shape its return type
uses to say so.

**Decision 3 — `source` at every call site is `AuditSource.Ui`, a known-wrong placeholder,
explicitly documented as such.**
Verified: `AuditSource` (`domain/model/model.scala:960`) is the closed set `Ui | Pat | Mcp |
System` — there is no generic "API request" member. Nothing available at the service layer today
(`AuthenticatedUser(id: UserId)` carries only an id — no token/channel info) lets a call site tell
UI, PAT, and MCP callers apart; that plumbing is the explicit scope of the follow-up attribution
ticket (proposal.md Non-goals). Rather than invent a new enum member (out of scope: this ticket
does not touch `AuditService`/domain model) or leave the choice to the executor (which the skeptic
correctly flagged as under-specified), every call site in this ticket passes `AuditSource.Ui`
uniformly. This is factually wrong for PAT/MCP-originated calls until the attribution ticket lands
— documented here, not silently — and is strictly better than `System` (which would misrepresent a
real user-initiated action as originating with no actor at all) or a guess at a new member (which
would require a migration/model change this ticket explicitly excludes).

**Decision 4 — Failed login metadata.**
`auth.login.failed` events carry `metadata = { "identifier": <attempted email/username> }` only —
no password field is read into the audit call at all (not redacted-after-the-fact; the raw
password value is simply never passed to `record`).

**Decision 5 — Pipeline "mutations" scope.**
"create/update/delete of pipelines (+ steps/runs submit)" is read as: pipeline create/update/
delete, pipeline step create/update/delete, and pipeline run *submission* specifically (not every
run status transition — those are system-driven, not a user mutation, and out of scope per "audit
strictly mutations + auth").

**Decision 6 — MFA-gated login.**
Verified: `AuthService.login` returns `Either[ServiceError, LoginOutcome]` where `LoginOutcome` is
`SessionEstablished | MfaRequired` (`AuthService.scala:59-63`); a session is only actually
established, for an MFA-enrolled user, once `MfaService.verifyLogin(req): Future[Either[ServiceError,
AuthResult]]` succeeds (`MfaService.scala:115`, calling private `establishSession`/
`recordFailedAttempt`). Per Decision 2 ("fire only on `Right`"), naively instrumenting only
`AuthService.login`'s `Right` branch would (a) emit `auth.login` for `Right(MfaRequired(...))`,
which has *not* established a session, and (b) emit nothing for the MFA verify step, which is
where the session is actually established or the login actually fails. Resolution:
- `AuthService.login` returning `Right(SessionEstablished(...))` → `auth.login` (unchanged).
- `AuthService.login` returning `Right(MfaRequired(...))` → `auth.login.challenged` (a session has
  not yet been established; this is new information for the trail, not a duplicate of `auth.login`).
- `AuthService.login` returning `Left(...)` (bad credentials, no MFA involved) → `auth.login.failed`
  (unchanged from Decision 4).
- `MfaService.verifyLogin` succeeding (`establishSession` path) → `auth.login` (this is the actual
  session-establishing event for an MFA-enrolled user; the earlier `auth.login.challenged` was not).
- `MfaService.verifyLogin` failing (`recordFailedAttempt` path, or any `Left`) → `auth.login.failed`.
`completeOAuth` applies the same `LoginOutcome` gate (per the skeptic's verification) and is
instrumented identically to `AuthService.login` at whatever its own call site is (§6.3 covers
locating it).

**Decision 7 — Composite mutations (duplicate, cascade) and per-mutation row cardinality.**
Verified: `DashboardService.duplicate` (`DashboardService.scala:116-129`) calls
`dashboardRepo.duplicate(...)` directly — it does not route through `create`, so it is not
automatically covered by instrumenting `create`. It produces one new dashboard plus N copied
panels in a single operation. Resolution: `duplicate` emits exactly one `dashboard.duplicate`
event (resource id = the *new* dashboard's id, metadata records the source dashboard id) — the
copied panels do **not** each additionally emit `panel.create`, because from an audit-trail
standpoint the meaningful actor-initiated action is "duplicated dashboard X as Y," not N
independent panel creations the actor never directly requested; a reviewer reading the trail wants
one row for one API call. The same reasoning applies to panel `duplicate` if it exists as its own
non-`create`-routed method (§3.2 confirms). For DB-level cascade (deleting a dashboard cascades its
panels at the schema level): cascaded panel deletions do **not** separately emit `panel.delete`
events — only the single `dashboard.delete` call the actor actually made is recorded, for the same
"one row per actor-initiated API call" principle, not one row per row physically deleted.
`specs/audit-mutation-instrumentation/spec.md` states this explicitly as its own requirement/
scenario rather than leaving "exactly one audit row" ambiguous for composite operations.

**Decision 8 — Data-source/data-type call-site enumeration is explicit, not delegated to a
grep-based catch-all.**
Verified: `DataSourceRoutes.scala` exposes `POST` (multiple create variants: `createStatic`,
`createCsv`, `createTextUpload`, `createTextUrl`, `createPdfUpload`, `createPdfUrl`,
`createImageUpload`, `createImageUrl`, all on `DataSourceService`), `PATCH` → `DataSourceService.update`,
and `DELETE` → `DataSourceService.delete`. `SourceRoutes.scala` is a **separate** route exposing
only creates — `SourceService.createSql`/`createRest` — with no update/delete of its own. Every
`DataSourceService.create*` variant emits `data_source.create` (same action regardless of which
create variant, since they all produce the same `data_source.create` fact from the audit trail's
perspective — the ingestion mechanism is an implementation detail, not part of the action
namespace); `update` emits `data_source.update`; `delete` emits `data_source.delete`.
`SourceService.createSql`/`createRest` also emit `data_source.create` — both return via
`CreateSourceResponse`, wrapping the same `DataSource` domain type `DataSourceService`'s own create
methods produce, so this is the same resource type under a different ingestion path, not a
separate one; no `source.create` action is needed. Data types are never created directly by a user
in the current routes (`GET/PATCH/DELETE /api/types/:id` only) — they are pipeline-produced; only
`data_type.update` and `data_type.delete` are instrumented, no `data_type.create`.

**Decision 9 — Remaining mutation surface, enumerated exhaustively against the route tree (not
discovered by a diff grep after the fact).** Independently re-walked every `post`/`put`/`patch`/
`delete` directive under `backend/src/main/scala/com/helio/api/routes/` to close the gaps round 2
of the design gate found:
- `panels/PanelRoutes.scala` `POST` → `PanelService.batchCreate` (`PanelService.scala:379`) and
  `POST` → `PanelService.batchUpdate` (`:315`), each acting on a `Vector` of panels in one API
  call. Per the Decision 7 "one row per actor-initiated API call" principle: `batchCreate` emits
  one `panel.batch_create` event with `resource_id` = the owning `dashboardId` and
  `metadata = {"count": N, "panelIds": [...]}"`; `batchUpdate` emits one `panel.batch_update`
  event the same way (`resource_id` = the request's implied dashboard/first panel's dashboard,
  `metadata` carrying the updated panel ids) — not one `panel.create`/`panel.update` per panel.
- `dashboards/DashboardContentsRoutes.scala` `PUT` → `DashboardContentsService.replaceContents`
  (`DashboardContentsService.scala:42`) — an atomic, all-or-nothing replace of an existing
  dashboard's entire panel set (HEL-363), bypassing `PanelService.create/update/delete` entirely.
  Emits one `dashboard.contents.replace` event, `resource_id` = the dashboard id, `metadata`
  carrying the new panel count — not a per-panel event, for the same composite-operation reasoning
  as Decision 7.
- `dashboards/DashboardSnapshotRoutes.scala` `POST /api/dashboards/import` →
  `DashboardService.importSnapshot` (`DashboardService.scala:231`) — creates a dashboard plus its
  panels from an export payload in one call. Emits one `dashboard.import` event, `resource_id` =
  the new dashboard's id, `metadata` carrying the imported panel count — not a `dashboard.create`
  (this is a distinct, snapshot-sourced creation path worth distinguishing in the trail) and not a
  per-panel event.
- `panels/BoundPanelRoutes.scala` `POST` → `BoundPanelService.create` (`BoundPanelService.scala:50`)
  — a single wizard-style call that may create a data source, a pipeline, and a panel bound to it,
  all from one API call. In scope (it is a panel-creating mutation the ticket's route list already
  names via `PanelRoutes`'s sibling surface); emits one `panel.create` event, `resource_id` = the
  resulting panel's id — the same action the plain `PanelService.create` path uses, since from the
  audit trail's perspective both produce "a new panel," and the underlying data source/pipeline
  creation is an implementation detail of how this one panel came to exist, not a separate
  actor-initiated resource creation the way a direct `POST /api/data-sources` call is.
- `panels/AutoLayoutRoutes.scala` `POST` → `AutoLayoutService.autoLayout`
  (`AutoLayoutService.scala:42`) — recomputes and persists panel layout for a dashboard; returns
  `Future[Either[ServiceError, Dashboard]]`, mutates layout only (no panel content change). In
  scope; emits one `dashboard.update` event (layout is a dashboard-owned field, not a distinct
  resource) — reuses the existing `dashboard.update` action rather than inventing a new one.
- `sources/UploadRoutes.scala` `POST` → `ImageUploadService.upload`
  (`ImageUploadService.scala:48`) — named in round 1's design gate and dropped silently in the
  round-1 revision; resolved here. **Corrected at design gate round 3**: `ImageUpload`
  (`domain/model/model.scala:648-656`) has no data source id at all and `upload` never touches
  `DataSourceService` — it writes bytes via `fileSystem.write` and inserts into its own
  image-upload repo, backing an Image panel's `imageUrl` directly (its own doc comment: "no parent
  DataType/row"). It is a distinct resource, not a `DataSource`. In scope; emits
  `image_upload.create`, `resource_id` = the resulting `ImageUploadId`.
- `pipelines/PipelineStepRoutes.scala` `PUT /api/pipelines/:id/steps/order` →
  `PipelineService.reorderSteps` (`PipelineService.scala:700`) — a batch, position-only reorder of
  a pipeline's existing steps within a single repository transaction. **Added at the final gate
  (skeptic-final-1 round 1)**: the executor's original route-audit enumeration mis-classified this
  as out of scope, but it is an ordinary pipeline-step mutation, not a new resource type. Emits one
  `pipeline.step.reorder` event per call (the same one-row-per-actor-initiated-call principle as
  `batchCreate`/`batchUpdate` above), `resource_id` = the pipeline id, `metadata` carrying the
  resulting ordered step ids — not one row per step.
- `pipelines/PipelineStepRoutes.scala` `POST /api/pipeline-steps/:id/duplicate` →
  `PipelineService.duplicateStep` (`PipelineService.scala:737`) — clones an existing step,
  inserting the clone immediately after the original. **Added at the final gate (skeptic-final-1
  round 1)**, same mis-classification as `reorderSteps` above. Emits one `pipeline.step.duplicate`
  event, `resource_id` = the new step's id, `metadata` carrying the source step id — mirrors
  `PanelService.duplicate`'s `panel.duplicate` shape exactly.

**Decision 10 — Composite *apply*/*undo* callers that fan out through already-instrumented
service methods.** Verified: `PatchSetApplyForward.applyOne` (`services/patchsets/
PatchSetApplyForward.scala:26`) applies each resolved edit "via the matching EXISTING per-resource
service method only" (its own header comment), dispatching to `panelService.create/update/delete`,
`dashboardService.create/update/delete`, `dataSourceService.createStatic/update/delete`,
`dataTypeService.update/delete`, `pipelineService.*` (`:33-90`) — so one `POST /api/patch-sets/apply`
call becomes one audit row per edit in the set. `PatchSetUndoService.undo` (`:64`) replays inverse
edits the same way. `DashboardProposalService.apply` (`services/proposals/
DashboardProposalService.scala:64`) similarly calls `dashboardService.create` then
`panelService.create`/`.update` per panel (`createAll`, `:83-97`) — one `POST /api/proposals/apply`
becomes `1 + N` rows.
- **Ruling: N rows are accepted as correct for these fan-out paths.** Each edit inside a patch-set
  apply, each inverse edit inside an undo, and each panel inside a proposal apply is itself a real,
  individually-meaningful resource mutation — an audit trail that collapsed a 4-edit patch-set
  apply into one opaque `patch_set.apply` row would hide which resources actually changed, which is
  worse for a security audit trail than a few extra rows. This narrows Decision 7's "one row per
  actor-initiated API call" principle: that principle applies to a single service composing a
  single logical operation into a single call (duplicate, batch, snapshot import); it does not
  apply to an already-generic apply/undo engine that is *itself* the composition of otherwise
  independent per-resource operations, each of which already has its own well-defined single-row
  behavior. No new plumbing (audit-suppression flag, apply-context parameter) is introduced for
  this ticket.
- **Exception, ruled explicitly: the rollback delete in `DashboardProposalService.createAll`
  (`:93`, `dashboardService.delete(dashboard.id, user)` after a partial-panel-creation failure)
  MUST NOT emit `dashboard.delete`.** Unlike the N-rows-accepted cases above, this path is not "an
  actor-initiated resource change" — it is internal cleanup of a dashboard the same call already
  failed to successfully create, and per Decision 2 ("a failed mutation never claims to have
  happened") writing `dashboard.create` followed by `dashboard.delete` for a dashboard that, from
  the caller's perspective, never came into existence, is exactly the false-trail case Decision 2
  exists to prevent. Fix: add `DashboardService.deleteInternal(dashboardId, user):
  Future[Either[ServiceError, Unit]]` — identical logic to the public `delete`, but never calls
  `AuditService.record`, doc-commented as "rollback-only, do not call from a route" — and have
  `DashboardProposalService.createAll`'s rollback branch call it instead of the public `delete`.
  This is the minimal fix: no new repository wiring into `DashboardProposalService`, and the public
  `delete` call site's own audit behavior is untouched.

**Decision 11 — MFA lifecycle mutations beyond `verifyLogin`.** `MfaRoutes.scala` exposes four
further `POST` mutations on `MfaService` (already in scope for `verifyLogin` per Decision 6):
`startEnrollment` (`:59`), `confirmEnrollment` (`:62`), `regenerateBackupCodes` (`:69`), `disable`
(`:76`). Ruled in, since each changes a user's authentication posture and `MfaService` already
receives `AuditService`:
- `startEnrollment` — **out of scope, no audit call.** It only issues a pending TOTP secret/QR
  challenge; no durable state changes until `confirmEnrollment` succeeds, so there is nothing yet
  to audit — unlike a login challenge (`auth.login.challenged`), which is itself security-relevant
  because it reveals a login attempt against an identity; here the actor's identity is already
  established, so an unconfirmed enrollment attempt has no comparable audit value.
- `confirmEnrollment` success → `auth.mfa.enable` (MFA becomes active for the user).
- `disable` success → `auth.mfa.disable`.
- `regenerateBackupCodes` success → `auth.mfa.backup_codes.regenerate`.

## Risks / Trade-offs

- Constructor signature changes ripple into every existing unit test for these services
  (`new DashboardService(..., auditService)`); mitigated by a single shared no-op/stub
  `AuditService` test fixture rather than repeating stub wiring per test file.
- Missing a call site (e.g. a bulk-delete or an edge mutation route) is the main correctness risk;
  mitigated by the executor cross-checking every route file listed in the ticket against its
  backing service's public mutation methods before considering a service "done."
