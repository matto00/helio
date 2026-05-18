# Design — HEL-265 Repo-Layer ACL Enforcement

This document settles the four open design questions from `ticket.md`. Each
answer is grounded in audit findings (see `executor-report-1.md` §Audit for
the underlying tables of repo methods, services, and callsites). Where a
decision could go either way, the trade-off is recorded explicitly.

## Q1 — Owned-only vs owned+shared semantics per callsite

### Decision

Three repository read flavors:

1. **`findById(id, user)`** — returns rows where `user` is the owner OR has a
   `resource_permissions` grant OR (for dashboards / panels) a public viewer
   grant when no user is supplied. Used by routes that need to honor sharing.
2. **`findByIdOwned(id, user)`** — returns rows only when `user` is the owner.
   Used where shared access would be semantically wrong (mutation / refresh /
   delete paths and anything pipeline-execution-adjacent).
3. **`findByIdInternal(id)`** — bypasses ACL entirely. Reserved for documented
   privileged background paths. Each call site is justified in code comments.

### Per-resource callsite map

The audit in `executor-report-1.md` §Service-side ACL surface enumerates every
public read; this section assigns the chosen flavor per callsite. Numbers in
parentheses reference file:line in the source tree at the cycle-1 commit.

**Dashboard** (`DashboardRepository.findById`)

| Callsite                                            | Flavor               | Rationale |
|-----------------------------------------------------|----------------------|-----------|
| `ApiRoutes.scala:51` (registry owner resolver)      | `findByIdInternal`   | Used by `AclDirective` itself; passing the user creates a chicken-and-egg loop. The resolver returns the owner; the directive does the comparison. |
| `DashboardService.delete:55`                        | `findByIdOwned`      | Delete is owner-only by definition. Even an editor-grant shouldn't delete. |
| `DashboardService.duplicate:71`                     | `findByIdOwned`      | Duplicate creates a brand-new owned dashboard; conferring duplication on shared users would be a sharing-policy change (out of scope). |
| `DashboardService.update:95`                        | `findById` (shared)  | Editor grant must be able to update layout / appearance; owner check + role gate stays in service. |
| `DashboardService.exportSnapshot:151`               | `findById` (shared)  | Viewer grant can already see the rendered dashboard via `PublicDashboardRoutes`; export is the same data plus pagination — no escalation. |
| `PublicDashboardRoutes` (panels under dashboard:38) | n/a — uses `panelRepo.findByDashboardId`; the directive's `authorizeResourceWithSharing` already gated dashboard access. The panel repo call becomes `findAllByDashboardId(dashboardId, callerOpt)` with the same flavor as the dashboard ACL above. |

**Panel** (`PanelRepository.findById`, `findByDashboardId`)

| Callsite                                                 | Flavor               | Rationale |
|----------------------------------------------------------|----------------------|-----------|
| `ApiRoutes.scala:52` (registry owner resolver)           | `findByIdInternal`   | Same as dashboard: resolver, not consumer. |
| `PanelService.findById:47`                               | `findById` (shared)  | Called by `PanelRoutes.scala:60` (`/panels/:id/query`) — must work for editor / viewer of the parent dashboard. Today it's wide open; that's a bug. |
| `PanelService.delete:116`, `duplicate:131`, `update:184` | n/a — these already route through `accessChecker.requireAccess("dashboard", panel.dashboardId, …)`, which is correct. The repo `findById` only fetches the row to learn `dashboardId`; that lookup is privileged-internal because the caller is going to be permission-checked against the parent dashboard anyway. Use `findByIdInternal`. |
| `PanelService.batchUpdate:154`                           | `findByIdInternal`   | Same reason — the service then enforces `panel.ownerId != user.id`. Repo's job: hand back the row so the service can check. |
| `PanelPatchApplier.scala:59` (post-patch read)           | `findByIdInternal`   | Internal applier; the caller has already done access checks. |
| `PublicDashboardRoutes:38` (`findByDashboardId`)         | sharing-aware        | Becomes `findAllByDashboardId(dashboardId, callerOpt)` with the dashboard-sharing predicate inlined; viewer & public-viewer grants on the dashboard let you see its panels. Mirrors today's behavior. |

**DataSource** (`DataSourceRepository.findById`)

| Callsite                                       | Flavor              | Rationale |
|------------------------------------------------|---------------------|-----------|
| `ApiRoutes.scala:53` (registry owner resolver) | `findByIdInternal`  | Resolver. |
| `DataTypeService.checkSourceLink:145`          | `findByIdInternal`  | Only used to render an error message ("cannot delete: this DT is the schema of source X"); the caller is already deleting a DataType the user owns — they need the source name for the error string. Use `*Internal` and document. |
| `DataSourceService.update:146`                 | `findByIdOwned`     | Mutation. The service was already calling `requireOwnerOnly` immediately before; the repo enforcement makes the prior check redundant — service simplifies. |
| `DataSourceService.delete:170`                 | `findByIdOwned`     | Mutation. |
| `DataSourceService.refresh:199`                | `findByIdOwned`     | Mutation. |
| `DataSourceService.preview:283`                | `findByIdOwned`     | Preview reads source data — owner-only because sources are not yet shareable. |
| `SourceService.refresh:175`                    | `findByIdOwned`     | Mutation (REST/SQL). |
| `SourceService.preview:223`                    | `findByIdOwned`     | Preview reads source data. |
| `PipelineRunService.submit:60`                 | `findByIdInternal`  | The pipeline ACL is checked one frame up; pipeline → source binding is a property of the pipeline definition. Sources can be join-targets for someone else's pipeline (today; future tickets may restrict this), so even after pipelines gain ACL we can't switch this to `findByIdOwned` without a deeper data-access model change. Document. |
| `PipelineRunService.previewStep:87`            | `findByIdInternal`  | Same as `submit`. |
| `PipelineRepository.create:84`                 | `findByIdOwned`     | Creating a pipeline against someone else's source is a hole; this is the right place to enforce it. Add `user` to `pipelineRepo.create`. |
| `JoinStep.evaluate:54`                         | `findByIdInternal`  | Pipeline execution path; the caller is the system. Document the cross-user implication: a join's right-source is unauthenticated. Out of scope for this ticket to restrict — flag as spinoff. |
| `SparkJobSubmitter.scala:199`                  | `findByIdInternal`  | Same as `JoinStep`. |

**DataType** (`DataTypeRepository.findById`, `findById(id, ownerId)`, `findBySourceId`)

| Callsite                                            | Flavor              | Rationale |
|-----------------------------------------------------|---------------------|-----------|
| `ApiRoutes.scala:54` (registry owner resolver)      | `findByIdInternal`  | Resolver. |
| `DataTypeService.findById:27`                       | `findByIdOwned`     | This is the HEL-268 leak — `GET /api/types/:id` currently returns cross-user DTs. Becomes owner-only (DataTypes have no sharing today). |
| `DataTypeService.listRows:33`                       | `findByIdOwned`     | HEL-242 analog (`/api/types/:id/rows`) — same leak. |
| `DataTypeService.validateExpression:43`             | `findByIdOwned`     | Reveals schema if you guess an id. Owner-only. |
| `DataTypeService.update:63`, `delete:121`           | `findByIdOwned`     | Mutation (today gated by `requireOwnerOnly` → the dedicated repo call replaces the double check). |
| `PanelService.resolveSingleBinding:73`              | `findByIdOwned`     | Already passes `user.id` — keep semantics; this is the existing "scrub cross-user binding" path. Switch from the existing 2-arg overload to `findByIdOwned`. |
| `PipelineRunService.upsertFieldsFromRows:305`       | `findByIdInternal`  | Privileged background — pipeline run schema update. The pipeline owner gated entry. |
| `SourceService.preview/refresh/upsertDataType` (3 sites: 241, 255, 265) | `findByIdOwned` via `findBySourceId(srcId, user.id)` | Already user-scoped; preserved. |
| `DataSourceService.upsertSourceDataType:256`        | `findByIdOwned` via `findBySourceId(srcId, user.id)` | Same. |
| `DataTypeRepository.isBoundToAnyPanel:107`          | `findByIdInternal` (effectively) — pure-count cross-resource query; converts to `existsBoundToAnyOwnedPanel(typeId, user)` so the count only sees this user's panels. Today, if user B has bound user A's DT to one of B's panels (impossible via UI but reachable via the leak we're fixing), A's delete would be wrongly blocked. After the fix, the leak closes anyway. |

**Pipeline** (`PipelineRepository.findById`, `listSummaries`, `findSummaryById`)

Today **none** of these accept a user. Pipeline tables have no `owner_id`. The
fix:

1. Flyway V32 adds `owner_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES users(id)` to `pipelines`. Backfill is via the same system-user default pattern V10 used.
2. `pipeline_steps` and `pipeline_runs` inherit access from their parent
   pipeline. No `owner_id` column on those — instead, the queries JOIN the
   parent's `owner_id`. This avoids duplicating the canonical owner.
3. Domain `Pipeline` gains `ownerId: UserId` (mirroring `Dashboard`).
4. Every method takes `user: AuthenticatedUser`:
   - `pipelineRepo.findById(id, user)` → owned (no sharing today)
   - `pipelineRepo.listSummaries(user)` → owner-scoped
   - `pipelineRepo.findSummaryById(id, user)` → owned
   - `pipelineRepo.delete(id, user)` → owned
   - `pipelineRepo.updateName(id, name, user)` → owned
   - `pipelineRepo.create(name, dsId, dtName, ownerId)` → already takes ownerId; also adds `findByIdOwned(dsId, user)` for the source check
   - `pipelineRepo.exists(id)` → becomes `existsOwned(id, user)` for the `addStep`/`listSteps` access guards
5. `pipelineStepRepo.listByPipeline(pid, user)` → JOIN with pipelines on pipeline_id, predicate on `pipelines.owner_id = user`
6. `pipelineStepRepo.findById(stepId, user)` → JOIN with pipelines, predicate same
7. `pipelineRunRepo.listByPipeline(pid, user)` → same JOIN
8. `ResourceTypeRegistry` gains `ResourceType("pipeline", id => pipelineRepo.findByIdInternal(id).map(_.map(_.ownerId.value)))` so a future PipelineRoutes refactor can use `AclDirective` if desired (CS5).

### Why not gate everything behind `findById` (single shared method)

We considered a single `findById(id, user, scope: Scope = Owner)` API with a
default of `Owner`. The default sounded safe — the failure mode of "forgot to
think about it" produces a tight scope. But two problems:

1. The default hides the design decision. Adding a new method should require
   the author to pick a flavor explicitly, the way passing `user` does today.
2. Sharing-aware queries have a meaningfully different SQL shape (the EXISTS
   clause + the public-viewer fallback). Mixing them into one method via a
   sentinel param means a single Slick query template branching on `scope`,
   which is harder to read than two explicit methods.

The three-method split (`findById` / `findByIdOwned` / `findByIdInternal`)
makes the choice loud at every callsite.

## Q2 — Application-layer JOIN vs PostgreSQL RLS

### Decision

**App-layer JOIN.** RLS is a deferred follow-up (suggested as a separate
HEL-271-ish ticket); document the trade-off here so future-us knows why.

### Reasoning

**App-layer JOIN — why it wins for this ticket:**

- Slick query composition is already the codebase's idiom (cf.
  `DataSourceRepository.scala:67`'s `table.filter(_.ownerId === ownerUuid)`,
  `DataTypeRepository.scala:46-54`'s owner-scoped reads). The pattern extends
  naturally to `OR EXISTS(subquery)` via Slick's `exists` combinator on a
  joined `TableQuery[ResourcePermissionTable]`.
- The existing repo tests use `EmbeddedPostgres + Flyway` (cf.
  `DataTypeRepositorySpec.scala:27-33`). Asserting "wrong user gets None" is a
  one-line spec addition per repo. RLS would need each test to set the
  per-connection session var or every assertion would be against an
  ACL-bypassed connection; far more invasive.
- The HikariCP wrinkle for RLS is real: every connection acquisition (every
  `db.run`) would have to issue `SET LOCAL helio.current_user_id = …` before
  the query and the txn rollback semantics must be honored. Slick offers no
  per-statement hook; we'd be adding a `MappedJdbcType` or wrapping
  `JdbcBackend.Database` to ensure session var presence. Several PRs of
  infrastructure work before a single ACL rule could be enforced.
- The owner indexes (V17) already cover `owner_id`. The `EXISTS` subquery hits
  `idx_resource_permissions_resource` (V16) + `idx_resource_permissions_grantee`.
  Both indices already exist. EXPLAIN plan stays at O(log n) per row scan.

**RLS — what it would have given us, and why we still want it eventually:**

- A new repo method authored without thinking about ACL would still be
  protected — RLS is the database refusing to return the row regardless of the
  SQL the app issued. App-layer JOIN demands every author remember to JOIN.
- Defense in depth against future SQL injection in the repo layer (currently
  we have parameterized queries everywhere, so the risk is theoretical, but
  RLS would close it).
- It's the right "future-final" layer once the foundation lets us reset session
  state cleanly.

**Q2 status (post-CS5):** The RLS layer is now tracked under epic **HEL-272**
(PostgreSQL RLS — belt + suspenders defense in depth), with sub-tickets
HEL-273 through HEL-277 covering: HikariCP session-var infrastructure (HEL-273),
RLS policy for dashboards (HEL-274), panels (HEL-275), pipelines (HEL-276), and
DataType + DataSource (HEL-277). All filed under the Helio v1.3.1 project.

**Hybrid (both)** is technically possible — app-layer JOIN today, RLS layered
on top later as belt + suspenders — and is the recommended end state. This
ticket ships the belt; the suspenders come later (HEL-272).

## Q3 — Sub-PR split strategy

### Decision

**Five sub-PRs, thematic.** Order chosen for risk-front-loading: the biggest
real security hole (pipelines wide open) first, then the most-leaked surface
(DataType `GET /:id`), then the most-touched surface (Dashboard + Panel).

### The plan

| PR | Theme | Touches | Behavior delta | Why this order |
|----|-------|---------|----------------|----------------|
| **CS1** | Pipeline `owner_id` foundation | Flyway V32, `Pipeline` domain, `PipelineRepository.findByIdInternal`, registry entry, `Pipeline` ⟷ row mapping. No service / route changes. Tests assert migration runs + default backfill. | None observable; pure additive | Lays the data-model foundation. Splitting it from CS2 keeps the migration review separate from the behavior review and makes a roll-back trivial if the backfill misbehaves on prod. |
| **CS2** | Pipeline ACL enforcement | `PipelineService` (every method takes `user`), `PipelineRunService` (every method takes `user`), `PipelineStepRepository` + `PipelineRunRepository` (every read takes `user` and JOINs to pipelines.owner_id), all `Pipeline*Routes` files thread `user` through. New regression tests: cross-user GET / POST / DELETE / run / preview / status / history all return 404. | **Substantial** — closes the biggest current security gap. | Highest user-facing impact. Going first means it's deployable independently if CS3+ stall. |
| **CS3** | DataType + DataSource enforcement | `DataTypeRepository.findById` collapses to `findByIdOwned`; the unscoped overload becomes `findByIdInternal` with documented call list. `DataTypeService.findById`, `listRows`, `validateExpression` switch to owner-scoped. `DataSourceRepository` reads gain `user` parameter; `DataSourceService` & `SourceService` lose their inline `if (ownerId != user.id)` checks. | Closes HEL-256 / HEL-268 leak. Owners' read paths unchanged. | Smaller-than-CS4 in callsite count but resolves the documented HEL-242/HEL-256/HEL-268 leaks immediately. |
| **CS4** | Dashboard + Panel enforcement | `DashboardRepository`/`PanelRepository` reads take `user`; sharing-aware variants land here because `PublicDashboardRoutes` consumes them. The `findByIdOwned` vs `findById` (shared) split per Q1's table. Service-level `if (ownerId != user.id)` checks deleted from `DashboardService.delete/duplicate/update/exportSnapshot` and `PanelService.batchUpdate`. | None observable for owners. Public viewers still work. | Touches sharing semantics — most prone to subtle regressions — so it's later, after the simpler patterns are baked. |
| **CS5** | Cleanup + spec sync | Audit pass for any remaining unscoped `findById` callers; add `*Internal` naming consistency; remove now-dead `AccessChecker.requireOwnerOnly` calls that the repo enforcement made redundant; update `JsonProtocols` / OpenAPI specs in `openspec/specs/` for any 403 → 404 status code shifts; performance smoke test (EXPLAIN ANALYZE on the new JOINs against a seeded dev DB). | None observable. | Closes the loop and keeps the change reviewable end-to-end without leaving orphan code in the codebase. |

### Why thematic over per-repo

Per-repo splitting (`CS1=Dashboard`, `CS2=Panel`, ...) was the originating
ticket's Option A. We rejected it because:

- Dashboard and Panel callsites are deeply intertwined via
  `PublicDashboardRoutes` and the `accessChecker.requireAccess("dashboard", ...)`
  pattern in PanelService — splitting them creates an interim where panel ACL
  is enforced but reads the dashboard ACL the old way (or vice versa).
- Pipeline-internal repos (`PipelineRunRepository`, `PipelineStepRepository`)
  inherit their ACL from `pipelines.owner_id`; splitting them into separate
  PRs from `PipelineRepository` would mean either landing them with no ACL
  (regression) or temporarily duplicating the JOIN logic.

Thematic groupings respect those couplings.

### Why not one big PR

Reviewed-line estimate: ~1,200 LoC of repo / service signature churn + ~600
LoC of new tests + 1 migration. That's a "one weekend of focused review"
PR. Splitting buys reviewer iteration without ever shipping a half-converted
state — each sub-PR leaves the codebase in a consistent ACL posture.

## Q4 — Backward-compat strategy

### Decision

**Atomic per-repo with callsite updates in the same commit.** No transitional
`findById` / `findByIdScoped` overload phase. Within each sub-PR, the repo
signature changes and every caller updates together.

### Reasoning

The codebase is single-codebase (no external consumers — backend repos are
only called by backend services + tests). The "ten small migration patches"
approach (Option A in the ticket) is the right pattern for libraries with
external consumers, but it leaves the codebase with mismatched ACL postures
during the migration. Mismatched postures are the exact bug class we're
fixing — having one repo enforce ACL and three not, mid-migration, is worse
than the current state.

Each sub-PR is atomic. Within CS3, for example, `DataTypeRepository.findById`
gains `user`, every consumer of `findById` is updated, the previously-unscoped
overload is renamed to `findByIdInternal`, and the regression tests land — all
in one commit. The compiler is the migration tool: forget a caller and `sbt
compile` fails.

For the one method that genuinely needs a transitional overload — the existing
`DataTypeRepository.findById(id)` + `findById(id, ownerId)` pair — CS3
collapses them in a single commit because every caller of the unscoped form
is already enumerated in the audit (`executor-report-1.md` §Repo public
surface).

### What about the registry-resolver chicken-and-egg

`ResourceTypeRegistry` in `ApiRoutes.scala:50` constructs its owner-resolver
lambdas with `dashboardRepo.findById(...)`. Those will fail to compile after
CS3 / CS4 because the new `findById` requires a user. Resolution: each of
those calls is the canonical `*Internal` callsite (it IS the resolver for
the ACL directive). Inside each sub-PR, the registry entry switches to
`findByIdInternal` in the same commit as the signature change.

## Risks & mitigations

- **Risk:** The new JOIN/EXISTS pattern is more expensive than the current
  single-table read.
  **Mitigation:** All needed indexes exist (V16, V17). EXPLAIN plan check in
  CS5's smoke test. If a hot path regresses (e.g. dashboard list at >100
  dashboards), we can denormalize a specific query before merging that sub-PR.
- **Risk:** Sharing-aware queries (`OR EXISTS(...)`) may produce duplicate
  rows if Slick translates them naively.
  **Mitigation:** Use Postgres's natural set semantics — the `EXISTS`
  subquery is a boolean predicate, not a join, so no duplication. Explicitly
  tested in CS4.
- **Risk:** Pipeline backfill (V32) assigns every existing pipeline to the
  system user, but if a deployed instance has pipelines created by real
  users today, they'd lose ownership.
  **Mitigation:** Cycle 1 audit confirms no pipeline owner concept exists
  today — every pipeline ever created is technically system-owned-by-implication.
  The migration's default is intentionally the same pattern V10 used. We will
  document in the V32 migration comments that any deployed instance with
  per-user pipelines must hand-update `owner_id` before deploying CS2.
- **Risk:** A `JoinStep` referencing another user's source becomes a
  documented `findByIdInternal` callsite — a real cross-user data access
  remains via that path.
  **Mitigation:** Out of scope for this ticket. Surface as a spinoff: "Join
  steps should require the source to be co-owned or shared with the pipeline
  owner." Document in CS2's PR description.
- **Risk:** Tests that fake repos (e.g. `AclDirectiveSpec` overrides
  `ResourcePermissionRepository`) might break when the test repo's signature
  changes.
  **Mitigation:** Inventory listed in `executor-report-1.md` §Test surface
  audit. Each affected test is updated in the same sub-PR.
