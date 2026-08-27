## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-read all artifacts fresh (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec
deltas) and re-derived every load-bearing backend claim from the tree rather than the prose.

**Round-1 CR1 (dependents visible proactively) — resolved.**
- design.md Decision 1b adds `dependentCount: Int` to `ConnectorMeta`, computed from the
  existing collaborator. Verified the collaborator exists exactly as claimed:
  `ConnectorEntityService.scala:18-21` — `final class ConnectorEntityService(connectorRepo:
  ConnectorRepository, dependentCount: ConnectorId => Future[Int] = _ => Future.successful(0))`.
- Verified the underlying query: `DataSourceRepository.scala:223` —
  `def countRestSourcesReferencing(connectorId: ConnectorId): Future[Int]` (raw SQL over
  `config ->> 'connectorId'`, `withSystemContext`). Signature matches the plan's usage.
- Verified wiring already exists at `ApiRoutes.scala:449`
  (`dependentCount = (id: ConnectorId) => dataSourceRepo.countRestSourcesReferencing(id)`), so
  the claim "reuse it, do not add a second count mechanism" is achievable with no new wiring.
- Coverage is now consistent across all three artifacts: tasks 1.1/1.2/1.3, spec delta
  `connectors/connector-management` scenario "Dependent count reflects referencing sources",
  and `connectors-page-ui` requirement "Dependent sources are visible proactively, not only on
  a blocked delete" + task 4.2. The "if the backend response carries it" hedge is **gone** —
  grepped; no occurrence remains in tasks.md.

**Round-1 CR2 (rotation layering) — resolved, and the new claim is true.**
- `ConnectorRepository.scala:20` — `class ConnectorRepository(ctx: DbContext, credentialRepo:
  ConnectorCredentialRepository)`. design.md's "constructor already takes a
  `ConnectorCredentialRepository` … so no new dependency needs wiring anywhere" is **correct**.
- Consequently the "no change at `ApiRoutes.scala:449` / `ConnectorEntityRoutesSpec.scala:92`"
  claim holds: the service constructor is genuinely unchanged by Decision 1.
- tasks.md matches the design: 2.1 puts orchestration in the repository, 2.3 is explicitly thin
  with "No new constructor dependency", 2.2 fixes the stale
  "rotation is a distinct, not-yet-built operation" comment. No residual prose anywhere still
  places the two-step in the service.
- Spec delta adds the rotation scenarios (success, fails-closed with no master key, cross-owner
  not-found). The MODIFIED requirement headers match the live spec exactly
  (`openspec/specs/connectors/connector-management/spec.md:10/37/49`), so the delta should
  validate.

**Round-1 CR3 (connection-test payload) — resolved, and correct against the endpoint.**
- `SourceService.testRest` (lines 198-214) re-read: rejects any `auth` outright; requires
  exactly one of `connectorId`/`url`; the `(Some(_), None)` arm resolves via
  `ConnectorResolveContext.Owned(user)`. Decision 3b's chosen payload
  `{ type: "rest_api", config: { connectorId } }` is the one shape that works for a saved
  Connector, and the rejection of a pre-save `url`-only test is well-reasoned (it would drop
  auth and green-light an unauthenticated request).
- Verified the reuse claim: `TestConnectionAffordance.tsx:16-20` does take a
  `buildConfig: () => SqlSourceConfig | RestApiConfigBody` callback, so this is a new payload
  variant rather than a new component, as design.md states.
- Consistent in tasks 4.4 (no test in create form) / 4.8 (payload spelled out) and both
  `connectors-page-ui` scenarios.

**Other checks:** no `TODO`/`TBD`/deferred decisions in design.md; Open Questions is genuinely
empty and the one escalation is recorded as resolved; every ticket AC traces to at least one
task (AC1→4.1/4.4/4.5/4.7, AC2→4.5/4.6 + spec, AC3→2.x/4.6/6.3, AC4→1.x/4.2/4.7, AC5→4.8,
AC6→5.1, AC7→4.9/Decision 4). No scope drift beyond the escalation-approved rotation backend.

### Verdict: CONFIRM

All three round-1 change requests are resolved substantively, not cosmetically, and the three
factual claims the revision rests on (repository already holds the credential repo; the service
already holds the dependent-count collaborator; the count query's signature) are each true in
the tree. What remains are implementation-detail omissions whose answers are forced or
mechanical — they belong in execution, not in another design round.

### Non-blocking notes

1. **Task 1.2 names the wrong layer for the `ConnectorMeta` assembly.** It says
   `ConnectorEntityService.findAll/findById` should "populate it on `ConnectorMeta.fromDomain`",
   but the service returns domain types (`Future[Vector[Connector]]` /
   `Either[ServiceError, Connector]`) and `ConnectorMeta.fromDomain(connector: Connector)` lives
   in `api/protocols/sources/ConnectorEntityProtocol.scala:50`, invoked from
   `ConnectorEntityRoutes` at four call sites. The service must not import the wire type. The
   implementer should pick the seam explicitly — service returns `(Connector, Int)` pairs (or a
   small `ConnectorWithDependents`) and the route maps it — and keep the protocol layer free of
   repository calls.
2. **`ConnectorMeta` gains a required field, so all four routes must supply it.** `POST` and
   `PATCH` also respond with `ConnectorMeta`; `dependentCount` is non-optional, so create can
   pass `0` but update needs a real count. The spec delta only speaks to read/list — worth one
   sentence so the update response isn't silently wrong. Also `connectorMetaFormat` is
   `jsonFormat8` (`ConnectorEntityProtocol.scala:64`) and becomes `jsonFormat9`.
3. **The frontend type for the test payload does not yet admit `connectorId`.**
   `RestApiConfigBody` (`frontend/src/features/sources/services/dataSourceService.ts:25-31`) has
   a **required** `url: string` and no `connectorId`. Task 4.8's payload needs `connectorId?:
   string` added and `url` relaxed to optional — which ripples into `createRestSource` /
   `inferFromJson` callers, so relax deliberately rather than by widening the shared type
   blindly.
4. **N+1 on the list path.** `findAll` over N Connectors issues N `countRestSourcesReferencing`
   queries, each a separate raw-SQL round trip on `withSystemContext`. Acceptable at realistic
   Connector counts, but if a single grouped count is cheap to write it is the better shape, and
   either way the choice is worth one line in the design.
5. `TestConnectionAffordance` hardcodes `add-source-modal__btn` CSS classes internally — reusing
   it on `/connectors` imports sources-modal styling. Watch this during the Phase 3 UI review
   against DESIGN.md (task 4.9).
6. Environment note, not a defect: this worktree's `scripts/concertino/` predates
   `next-report-number.sh`/`persist-evidence.sh`; I invoked the canonical copies from the main
   repo at `/home/matt/Development/helio/scripts/concertino/`.
