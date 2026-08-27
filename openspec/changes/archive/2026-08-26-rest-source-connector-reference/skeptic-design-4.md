## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, the full revised `design.md` (Decisions 1–10), `tasks.md`
(sections 1, 2, 2a, 3–7), both spec deltas, and `skeptic-design-1/2/3.md`. Then re-derived
from source in the worktree.

**Round-3 CR fixes — checked against source, not prose:**

- **CR1/CR2 (ephemeral sentinel)** — Decision 1c now specifies a structurally distinct
  `EphemeralRestConfig(url, method, headers)` + `fetchEphemeral`/`inferSchemaEphemeral`/
  `testConnectionEphemeral` (task 2a.2), never persisted, never a `RestApiConfig`, and task
  2a.2a rejects reserved sentinel strings at the `toDomain` boundary. The bypass round 3
  found is closed structurally: the ephemeral path no longer shares the `connectorId`
  namespace at all. I checked the one remaining round-trip worry — a `__unmigrated__`
  sentinel echoed to a client via `DataSourceProtocol.scala:213`
  (`RestApiConfigPayload.fromDomain`) and posted back — and there is **no** source
  update/PATCH route (`grep` over `api/routes/sources/` finds none), so there is no
  round-trip that would now 400. **Closed.**
- **CR3 (`PipelineService`)** — task 1.8 names `resolveInlineSourceSchema`/
  `resolveProposalSourceSchema` explicitly and picks a resolution. Confirmed the call site
  is real (`PipelineService.scala:7,343`). **Closed.**
- **CR4 (`requiredFields`)** — Decision 10 + task 1.9 cover `RestApiConnectorDriver.metadata`
  and the pinned `ConnectorRegistrySpec` assertion. **Closed.**
- **CR5 (`owner_id IS NULL`)** — explicit fourth migration branch, Decision 7 revision +
  tasks 4.1/4.1a. **Closed.**
- **CR6 (`updateConfig` doesn't exist)** — replaced with a new `updateConfigInternal` under
  `withSystemContext` (task 4.0a). Confirmed against `DataSourceRepository` (no
  `updateConfig`; only `update(source, user)`) and `DbContext.withSystemContext`. **Closed.**

**Composition check (question 3):** the three reserved-value schemes do compose. Decision 6's
`__unmigrated__`/`__malformed__` are produced only by `rowToDomain` on a DB read and fail
closed at `findByIdOwned`; Decision 1c's ephemeral path no longer uses `connectorId` at all;
task 2a.2a makes the sentinel namespace unwritable from the wire. No conflict found.

**Fresh ground truth gathered this round** (broad grep across `backend/src/main` for
`RestApiConfig`/`RestApiConfigPayload`/`RestSource`/`decodeRest`/`encodeRest`):

- `InProcessPipelineEngine.scala:127-137` — `case r: RestSource => connector.fetch(r.config,
  maxRunRows)`. A `ConnectorDriver[RestApiConfig].fetch` call site that is **not**
  `SourceService` and **not** a route, and that holds **no** `AuthenticatedUser`.
- `PipelineRunService.scala:26-51,150-168` — constructs the engine
  (`new InProcessPipelineEngine(fileSystem, connector)`); `submit` gates on
  `pipelineRepo.findByIdShared(pipelineId, Some(user))` (HEL-279 grantee sharing) and then
  loads the source with `dataSourceRepo.findByIdInternal(...)` — the comment at line 155-163
  states plainly that this bypasses ownership so that *editor grantees who are not the owner*
  can run the pipeline. HEL-758 routed `rest_api` through this same path.
- `PipelineSchedulerService.scala:108-118` — cron-fired runs synthesize
  `AuthenticatedUser(pipeline.ownerId, source = AuditSource.System, tokenId = None)`, i.e. the
  **pipeline** owner, not the data source's owner.
- `ConnectorRepository.scala` (at `infrastructure/persistence/sources/`, not `.../connectors/`)
  — public methods are `create`, `findByIdOwned`, `findAll`, `update`, `delete`. There is **no
  unscoped/internal connector lookup**; every one runs under `ctx.withUserContext(user.id...)`.
- `ConnectorRepository.scala:124-128` — `delete(id, user, dependentCount: ConnectorId =>
  Future[Int] = _ => Future.successful(0))`. The collaborator's type takes **only a
  `ConnectorId`** — no user.
- `ConnectorEntityService.scala:17-20` — `dependentCount: ConnectorId => Future[Int]` is a
  **constructor** parameter.
- `ApiRoutes.scala:432-439` — `connectorEntityServiceOpt` is where `new
  ConnectorEntityService(connectorRepo)` is actually constructed (app-lifetime, inside
  `ApiRoutes`), **not** `Main.scala`, and no `AuthenticatedUser` exists at that point.

### Verdict: REFUTE

All six round-3 CRs are genuinely closed, and the cumulative sentinel/reserved-value schemes
compose without conflict. But the broad grep this round surfaced a **fourth live consumer**
that three rounds have not named — the pipeline execution engine — and it is worse than the
previous three because it is not merely a compile break: the design's ownership-scoped
resolution rule regresses an already-shipped capability there. Separately, the ticket's own
designated highest-risk item (`dependentCount`) is specified against a collaborator signature
and a construction site that cannot carry what tasks 3.1/3.2 ask them to carry — the same
class of unimplementable-as-written reference round 3 caught as CR6.

### Change Requests

1. **`InProcessPipelineEngine`'s `RestSource` fetch is an uncovered call site, and
   ownership-scoped connector resolution regresses HEL-279 shared-pipeline runs there.**
   `InProcessPipelineEngine.scala:127-137` calls `connector.fetch(r.config, maxRunRows)` with
   no user. Task 2.2 says every `ConnectorDriver[RestApiConfig]` call site "now needs the
   acting user — thread it through from `SourceService`/routes"; the engine is neither, and
   design.md/tasks.md never mention `InProcessPipelineEngine`, `PipelineRunService`, or
   `PipelineSchedulerService` anywhere. Two distinct problems, both need an answer:
   (a) *Compile/threading:* `fetch`'s signature change must be threaded engine →
   `PipelineRunService` → `submit`/`previewStep`/`executeRun` (all of which do hold a user),
   and the `fetchOverride`/nullable-connector test seams updated. Name this as a task.
   (b) *Semantics — the blocking half:* `PipelineRunService.submit` deliberately loads the
   source with `findByIdInternal` (`PipelineRunService.scala:150-163`, comment: "Safe:
   pipeline ACL confirmed by `findByIdShared`… so editor grantees (not pipeline owners) are
   not blocked by V35 RLS"). Under Decision 3, that same run would resolve the connector via
   `ConnectorRepository.findByIdOwned(connectorId, actingUser)` — which returns `None` for a
   grantee, because `ConnectorRepository` exposes **no** unscoped lookup and every method runs
   under `withUserContext`. A shared REST-source pipeline that runs today (HEL-758 wired
   `rest_api` into this path) would start failing with the curated "connector not found"
   error from task 2.3. The scheduler has the mirror-image problem: it acts as
   `pipeline.ownerId` (`PipelineSchedulerService.scala:110`), which is not necessarily the
   data source's / connector's owner. Decide explicitly and add the task + test: either the
   fetch path resolves the connector by the **source's** owner via a new internal lookup
   (privileged, mirroring `findByIdInternal`'s already-reviewed precedent — the ACL gate being
   the pipeline, as the existing comment argues), or shared/scheduled REST runs are knowingly
   restricted to owner-run only and that regression is stated. Do not leave this to
   implementer inference: it is an RLS/ownership choice on a credential-decrypting path.

2. **Tasks 3.1/3.2 (`dependentCount`, the ticket's stated highest-risk item) are not
   implementable as written.** Task 3.1 specifies `countRestSourcesReferencing(connectorId:
   ConnectorId, user): Future[Int]`; task 3.2 says to wire it "into `ConnectorEntityService`'s
   construction (`Main.scala`), replacing the always-zero default." Ground truth contradicts
   both halves:
   - `dependentCount`'s type is `ConnectorId => Future[Int]`
     (`ConnectorRepository.scala:127`, `ConnectorEntityService.scala:19`) — there is no
     channel for a `user`. Supplying a user-scoped query therefore requires **changing that
     collaborator's type** to `(ConnectorId, AuthenticatedUser) => Future[Int]` (and the
     `delete(...)` call at `ConnectorRepository.scala:132`), i.e. an edit to already-shipped
     HEL-821 code that HEL-821's own scaladoc explicitly claims will need "no further
     change." Design.md Decision 5 asserts the opposite ("no further route/repository change
     needed at that point, only a new collaborator wired in at construction") — that claim is
     false against source and must be corrected.
   - The construction site is `ApiRoutes.scala:432-439`, **not** `Main.scala`, and it is
     app-lifetime: no `AuthenticatedUser` exists there, so the lambda
     `(id) => dataSourceRepo.countRestSourcesReferencing(id, user)` that Decision 5 writes
     verbatim cannot be written at all.
   Resolve concretely: name the new collaborator signature, name `ApiRoutes.scala` as the
   wiring site, and confirm `dataSourceRepo` is in scope there (it is constructed in
   `ApiRoutes`) — or choose an unscoped/internal count and justify why counting across owners
   is safe. As-is, the AC "the 409 becomes genuinely reachable" cannot be implemented from
   this design without the executor inventing the missing signature change.

### Non-blocking notes

- Task 3.1's user-scoping is probably right on the merits (connectors are owner-scoped, so a
  referencing source is necessarily the same owner) — the objection in CR2 is purely that the
  plumbing to deliver a user doesn't exist, not that the scoping choice is wrong.
- `AssistantToolExecutor.scala:30,198,236` (`VerifiedConfig.Rest(config: RestApiConfigPayload)`,
  used as a `Set` membership key for the verified-before-apply check) will change equality
  semantics when the payload's fields change. Task 1.7 covers the file; one line confirming the
  verified-set match still works for the new shape would be worth adding.
- `DataSourceProtocol.scala:213` wraps the rest payload in `SecretRedaction.redact`. Task 1.5
  already asks the executor to read the consumer rather than assume; noting the exact line here
  so it isn't re-derived.
- Round 2/3's `jsonPath` note still stands (`RestApiForm.tsx` sends it; today's `jsonFormat4`
  silently drops it) — one explicit line that the new reader still ignores unknown fields
  rather than 400-ing.
