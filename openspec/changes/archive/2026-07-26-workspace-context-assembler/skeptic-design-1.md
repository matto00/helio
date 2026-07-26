## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **`confineScopedToken` behavior (D6 claim).** Read
   `backend/src/main/scala/com/helio/api/AuthDirectives.scala:133-155`. Confirmed: a scoped-token
   request is denied with `403 Forbidden` unless the first unmatched path segment is exactly
   `"hooks"` (`firstSegment.contains("hooks")` — exact-segment match, not `startsWith`). Also read
   `ApiRoutes.scala:239-360`: `confineScopedToken` wraps the *entire* three-way `pathPrefix("auth")`
   / `optionalAuthenticate` / `authenticate` `concat(...)`, and `WorkspaceRoutes` is mounted inside
   the `authenticate` branch at line 354. Since `/api/workspace/context`'s first segment is
   `"workspace"`, not `"hooks"`, a scoped PAT is rejected before `WorkspaceRoutes`/`authenticate`
   ever runs. Design.md D6's claim matches the code exactly — this is not re-implemented, correctly
   inherited.

2. **Unconditional wiring (D2 claim).** Read `ApiRoutes.scala:131,141,147` — `dashboardService`,
   `dataSourceService`, `pipelineService` (and `dataTypeRepo`, constructed earlier) are all plain
   `private val`s, not `Option`-wrapped, unlike `workspaceTeardownServiceOpt` (line 206-207, which
   is `Option`-guarded on `dbContext` for its cross-table transaction need). D2's claim that no
   `Option`-guard is needed for the new service holds.

3. **Owner-scoping of every fan-out read.**
   - `DashboardService.findAll(user, page)` → `dashboardRepo.findAll(user.id, page)` (`DashboardService.scala:40`).
   - `DataSourceService.findAll(user, page, tag)` → `dataSourceRepo.findAll(user.id, page, tag)` (`DataSourceService.scala:85-86`).
   - `DataTypeRepository.findAll(ownerId, page, tag)` filters `r.ownerId === ownerUuid` inside
     `ctx.withUserContext(ownerId.value)` (`DataTypeRepository.scala:49-63`).
   - `PipelineRepository.listSummaries(user, tag)` filters `p.ownerId === ownerUuid` inside
     `ctx.withUserContext(user.id.value)` (`PipelineRepository.scala:339-351`).
   All four are owner-only exactly as design.md claims — no cross-tenant leak vector in the list
   fan-out.

4. **No HEL-363-class existence leak.** The assembler never looks up an individual resource by a
   caller-supplied/foreign id — every `analyze(pipelineId, user)` call is only ever invoked against
   `pipelineId`s that the caller's own `listSummaries` (owner-scoped) already returned. Confirmed
   `PipelineService.analyze` (`PipelineService.scala:165-206`) is sharing-aware
   (`findSummaryByIdShared`/`findByIdShared`), but since the id space feeding it is already
   caller-owned, sharing-awareness here is a strict superset (never narrower) of what's needed — no
   403-instead-of-404 leak class is introduced, because no unauthorized id is ever probed.

5. **`analyze` cost (D5 claim).** Read `PipelineService.scala:165-206`. Confirmed: no Spark job, no
   heavy I/O — two repo reads (`findSummaryByIdShared`, `findByIdShared`), one step-repo read
   (`listByPipelineInternal`), one additional `dataTypeRepo.findBySourceId` read (design.md's
   text undercounts this by one call, calling it "two repo reads + one step-repo read" — see
   non-blocking note below), and an in-memory `PipelineAnalyzeService.analyze` call. The conclusion
   "DB-cheap, no Spark" holds regardless of the miscount. `Future.sequence`/parallel fan-out over
   the caller's own (owner-scoped) pipeline list is a reasonable, deliberately-justified choice, not
   a silently-repeated N+1 — the risk is explicitly named (D5, Risks/Trade-offs) and bounded to
   "ticket-stated scope," with a stated escalation criterion (batch-analyze deferred until evidence
   of contention).

6. **`WorkspaceRoutes` wiring today.** Read `backend/src/main/scala/com/helio/api/routes/WorkspaceRoutes.scala`
   — confirmed current shape (`pathPrefix("workspace") { path("teardown") { ... } }`, constructor
   `(workspaceTeardownService, user)`). Design.md's plan to add a `context` sub-path inside the same
   `pathPrefix("workspace")` and extend the constructor is consistent with the existing file
   structure; no restructuring needed.

7. **`pipelineShapes` omission and page-size parity (D3/D4 claims) vs. real TS source.** Read
   `helio-mcp/src/context.ts` in full. Confirmed `WorkspaceContext.pipelineShapes` exists in the TS
   interface and is fanned out via `api.listPipelineShapes()` (lines 82-95, 113-120, 198-206) — D4's
   claim that this ticket's scope/AC text omits it is accurate (ticket.md's Scope/AC bullets list
   only `counts`, `dataSources`, `dataTypes`, `pipelines`, `dashboards`), and the justification
   (`PipelineShapeService` is stateless/code-level, no RLS/N+1 story) is sound. Confirmed
   `helio-mcp/src/helioApi.ts:154,177,215` — `listDashboards`/`listDataSources`/`listDataTypes` all
   default to `limit = 200, offset = 0`; `backend/.../domain/pagination.scala:11` —
   `Page.Default = Page(offset = 0, limit = 200)`. D3's "mirror the MCP's own default, not the
   repo's max (500)" claim is exact.

8. **DataType classification (D7).** Read `backend/.../domain/model.scala:522-527` —
   `DataType.sourceId: Option[DataSourceId]`. D7's claim that the domain object is read directly
   (no lossy spray-json round-trip) rather than reusing the wire-level normalization pattern is
   architecturally sound and avoids the exact gotcha `context.ts` documents inline (`t.sourceId ?? null`
   working around spray-json omitting `None` fields).

9. **Spec/tasks completeness against the design-gate asks.** `specs/workspace-context-assembly/spec.md`
   has explicit, testable scenarios for: 200 body shape, empty-workspace 200, owner-scoping
   (two-user isolation), scoped-PAT 403, `pipelineOutput` classification (both directions), per-step
   `outputColumns` in order, and single-pipeline analyze-failure degradation without failing the
   whole request. `tasks.md` 4.1-4.8 map 1:1 onto these scenarios, including the specific
   scoped-PAT-denial test (4.7) and per-pipeline analyze-failure-degradation test (4.5) the human
   asked to see explicitly planned, not deferred.

10. **No migrations, no schema-name collision.** `ls schemas/` confirms `workspace-context.schema.json`
    does not already exist (only `workspace-teardown-{request,response}.schema.json` are present).

### Verdict: CONFIRM

The design resolves all three explicitly-flagged attention items with evidence, not assertion:
RLS/ACL scoping is real and verified against the actual repo/service code (not just claimed), the
N+1 `analyze` fan-out is a deliberate, justified, bounded choice grounded in `analyze`'s real cost
(confirmed non-Spark), and the payload shape (flat per-DataType/per-pipeline case classes) is
naturally additive for the four follow-up HEL-345 tickets without forcing a reshape. No
placeholders, no internal contradictions, no scope drift found. Every AC in `ticket.md` is covered
by a spec scenario and a task.

### Non-blocking notes

- design.md D5 undercounts `analyze`'s repo reads by one (it omits the `dataTypeRepo.findBySourceId`
  call at `PipelineService.scala:178`); doesn't change the "DB-cheap, no Spark" conclusion, but worth
  a one-line fix for accuracy since the design gate is meant to ground claims in real cost.
- design.md D2's phrasing "gains the new service as a second argument" is slightly imprecise —
  `WorkspaceRoutes`'s current constructor already has two params (`workspaceTeardownService`, `user`);
  the new service becomes a third constructor param (or displaces `user`'s position). Not ambiguous
  enough to block — `tasks.md` 3.2 states the intent correctly ("take `WorkspaceContextService`
  alongside the existing `WorkspaceTeardownService`") — but the executor should not read D2 as
  prescribing an exact 2-arg constructor.
- The TS `WorkspaceContext.pipelines[].steps` entries also carry `type`, `position`, and
  `validationError` (`context.ts` lines 69-74) beyond `outputColumns`; the spec/tasks only test
  `outputColumns` explicitly. Not a blocking gap — the ticket's own AC only requires
  `outputColumns` — but the executor should decide during 1.1 whether `WorkspaceContextPipelineStep`
  carries the full per-step parity set (`type`/`position`/`validationError`) or just
  `outputColumns`, and note the choice in the schema description alongside the D4 `pipelineShapes`
  delta, for consistency with the "structural parity documented in the schema" AC.
