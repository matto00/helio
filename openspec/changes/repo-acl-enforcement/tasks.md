# Tasks — HEL-265 Repo-Layer ACL Enforcement

Cycle structure follows the five-sub-PR plan in `design.md` Q3. Each cycle is
a separate PR; orchestrator confirms before kicking off the next.

## Cycle 1 — Investigation + design (THIS CYCLE)

- [x] Audit ACL infrastructure (`AclDirective`, `AccessCheckerImpl`,
      `ResourceTypeRegistry`, V10/V14/V15/V16/V17 migrations)
- [x] Enumerate public reads on every ACL'd repo + every callsite
- [x] Identify pipelines having no ownership concept (scope-expanding finding)
- [x] Settle Q1 (per-callsite owned-only vs owned+shared)
- [x] Settle Q2 (app-layer JOIN vs RLS)
- [x] Settle Q3 (sub-PR split)
- [x] Settle Q4 (backward-compat)
- [x] Write `proposal.md`, `design.md`, `tasks.md`, `executor-report-1.md`

## Cycle 2 (PR/CS1) — Pipeline `owner_id` foundation

Pure additive. No behavior change. Lays the data-model + repo-resolver
foundation that CS2 builds on.

- [x] Flyway `V32__pipelines_owner.sql`: `ALTER TABLE pipelines ADD COLUMN owner_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES users(id);`
- [x] `V32` also adds `CREATE INDEX idx_pipelines_owner_id ON pipelines(owner_id);`
- [x] Document in V32's comment block: "pre-V32 pipelines are assigned to the
      system user; production deployments with per-user pipelines must
      hand-update owner_id before this migration"
- [x] Extend `PipelineRepository.PipelineRow` + `PipelineTable` with the
      `owner_id` column
- [x] Extend domain `Pipeline` case class with `ownerId: UserId`
- [x] Add `PipelineRepository.findByIdInternal(id): Future[Option[Pipeline]]`
      — same SQL as today's `findById`, just renamed to signal its
      no-ACL nature
- [x] Update `ResourceTypeRegistry` (in `ApiRoutes.scala`) to register
      `ResourceType("pipeline", id => pipelineRepo.findByIdInternal(id).map(_.map(_.ownerId.value)))`
- [x] Existing `pipelineRepo.findById` keeps current signature for this PR;
      CS2 replaces it
- [x] Tests: `PipelineRepositorySpec` — assert default backfill is the system
      user id; assert insert with explicit owner persists correctly; assert
      registry resolver returns the owner
- [x] Gates: `sbt test`, `npm run check:openspec`, `lint`, `format:check`

## Cycle 3 (PR/CS2) — Pipeline ACL enforcement

The biggest user-facing impact: closes the wide-open pipeline surface.

- [x] `PipelineRepository.findById(id, user)` — returns owned-only
- [x] `PipelineRepository.listSummaries(user)` — filter by `owner_id`
- [x] `PipelineRepository.findSummaryById(id, user)` — owned-only
- [x] `PipelineRepository.delete(id, user)` — owned-only
- [x] `PipelineRepository.updateName(id, name, user)` — owned-only
- [x] `PipelineRepository.updateLastRun(id, ..., user)` — owned-only
- [x] `PipelineRepository.create(name, dsId, dtName, user)` — call
      `findByIdOwned(dsId, user)` on the source (new method, owned variant of
      `dataSourceRepo.findById`)
- [x] `PipelineRepository.exists(id, user)` — JOIN-based existence check
- [x] `PipelineStepRepository.listByPipeline(pid, user)` — JOIN pipelines on
      pipeline_id, predicate `pipelines.owner_id = user`
- [x] `PipelineStepRepository.findById(stepId, user)` — same JOIN
- [x] `PipelineStepRepository.update / delete` — same JOIN predicate
- [x] `PipelineRunRepository.listByPipeline(pid, user)` — same JOIN
- [x] `PipelineRunRepository.insertRun/insertDryRun/updateRunTerminal/...`
      take `user` and verify the pipeline is owned before write
- [x] `PipelineService` every method takes `user`; remove pipelineRepo helpers
      that don't
- [x] `PipelineRunService` every method takes `user`; the privileged
      cross-user source lookup uses `dataSourceRepo.findByIdInternal` and is
      documented in code
- [x] `PipelineRoutes`, `PipelineStepRoutes`, `PipelineRunSubmitRoutes`,
      `PipelineRunStatusRoutes`, `PipelineRunHistoryRoutes`,
      `PipelineRunStreamRoutes` — each thread `authenticatedUser` through
      every service call
- [x] New tests: cross-user `GET /api/pipelines/:id` returns 404; cross-user
      `POST /api/pipelines/:id/run` returns 404; cross-user `DELETE`,
      `PATCH`, step CRUD, run-history, SSE-stream, status all return 404
- [x] New tests: same operations as same user succeed
- [x] New tests: pipeline create rejects a sourceDataSourceId the user
      doesn't own (404, not 400)
- [x] Gates: full suite

## Cycle 4 (PR/CS3) — DataType + DataSource enforcement

Closes HEL-256 / HEL-268 leaks. Collapses the awkward `findById(id)` +
`findById(id, ownerId)` overload pair on `DataTypeRepository`.

- [x] `DataTypeRepository.findByIdOwned(id, user)` — collapses the existing
      2-arg overload; semantically identical
- [x] `DataTypeRepository.findByIdInternal(id)` — keeps the existing
      no-user variant under a documented name; ONLY callers:
      `ResourceTypeRegistry` resolver + `PipelineRunService.upsertFieldsFromRows`
- [x] `DataTypeRepository.existsBoundToAnyOwnedPanel(typeId, user)` —
      replaces `isBoundToAnyPanel`, owner-scoped count
- [x] `DataTypeService.findById` switches to `findByIdOwned`
- [x] `DataTypeService.listRows` switches to `findByIdOwned` (closes
      HEL-242 leak)
- [x] `DataTypeService.validateExpression` switches to `findByIdOwned`
- [x] `DataTypeService.update / delete` — the redundant `requireOwnerOnly`
      call removed; repo's owner predicate covers it. `None ⇒ NotFound`
      branch preserves the existing error.
- [x] `DataTypeService.checkSourceLink` switches to `findByIdInternal`
      (documented: error-message rendering, no data leak)
- [x] `DataSourceRepository.findByIdOwned(id, user)` — new method
- [x] `DataSourceRepository.findByIdInternal(id)` — rename of existing
      `findById`
- [x] `DataSourceService` every public method that previously did
      `requireOwnerOnly` + `dataSourceRepo.findById` collapses to a single
      `dataSourceRepo.findByIdOwned(id, user)` call
- [x] `SourceService.refresh / preview` — same collapse
- [x] `PanelService.resolveSingleBinding` switches from the 2-arg overload
      to `findByIdOwned`
- [x] New tests: cross-user `GET /api/types/:id` returns 404 (was: leaks
      DT); cross-user `GET /api/types/:id/rows`; cross-user
      `validate-expression`; cross-user `GET/PATCH/DELETE
      /api/data-sources/:id`; cross-user `POST /api/data-sources/:id/refresh`;
      cross-user `GET /api/data-sources/:id/preview`
- [x] Gates: full suite

## Cycle 5 (PR/CS4) — Dashboard + Panel enforcement

Most subtle because of sharing semantics (`PublicDashboardRoutes`,
`authorizeResourceWithSharing`).

- [ ] `DashboardRepository.findById(id, callerOpt)` — sharing-aware: owner
      OR `resource_permissions` grant OR public-viewer fallback when
      `callerOpt = None`
- [ ] `DashboardRepository.findByIdOwned(id, user)` — owner-only
- [ ] `DashboardRepository.findByIdInternal(id)` — registry resolver only
- [ ] `DashboardRepository.findAll(user)` — already owner-scoped; add a
      sharing-aware overload `findAllVisible(user)` for any future "shared
      with me" UI (not consumed in this PR — feature-flagged off)
- [ ] `PanelRepository.findByIdInternal(id)` — rename of existing
      `findById`; documented callers: registry resolver, batch reads
      bound for service-level ACL checks
- [ ] `PanelRepository.findById(id, callerOpt)` — sharing-aware via the
      parent dashboard's ACL
- [ ] `PanelRepository.findAllByDashboardId(dashboardId, callerOpt)` —
      sharing-aware via the parent dashboard's ACL (used by
      `PublicDashboardRoutes`)
- [ ] `DashboardService.delete/duplicate/update/exportSnapshot` — remove
      the inline `if (existing.ownerId != user.id)` checks; switch to
      `findByIdOwned` for delete/duplicate and `findById` for
      update/exportSnapshot per design.md Q1 table
- [ ] `PanelService.findById` — switch to sharing-aware `findById(id, Some(user))`
      so `/api/panels/:id/query` honors dashboard sharing (today this is
      a hole — the panel query endpoint has no ACL at all)
- [ ] `PanelService.batchUpdate` — collapse the inline owner check; uses
      `findByIdInternal` because the immediate service-side `requireAccess`
      on the parent dashboard is the authoritative gate
- [ ] `PublicDashboardRoutes` — `panelRepo.findByDashboardId` becomes
      `findAllByDashboardId(dashboardId, userOpt)` (sharing-aware); the
      `AclDirective.authorizeResourceWithSharing` wrapper stays because it
      provides the `ResourceAccess` discriminator the route uses
- [ ] New tests: owner read paths unchanged (regression); editor grant on
      dashboard can read panels + update dashboard layout; viewer grant
      can read but not mutate; cross-user with no grant returns 404; the
      public-viewer fallback continues to work for an anonymous request
- [ ] New tests: `/api/panels/:id/query` honors dashboard sharing (was: open)
- [ ] Gates: full suite + manual EXPLAIN check on the sharing-aware SELECT

## Cycle 6 (PR/CS5) — Cleanup + spec sync

- [ ] Grep for any remaining unscoped `*Repo.findById(` callers in
      `services/` or `api/`; convert to the appropriate `*Owned` or
      `*Internal` variant or document why
- [ ] Audit `AccessChecker.requireOwnerOnly` callers; remove ones the repo
      enforcement made redundant
- [ ] Update OpenAPI `openspec/specs/` for any 403 → 404 status-code shifts
- [ ] Performance smoke: EXPLAIN ANALYZE on dashboard list, type list,
      pipeline list against a seeded dev DB with ~100 resources / user
- [ ] Surface spinoff tickets:
      - Cross-user `JoinStep` rightDataSourceId (pipeline can reference
        another user's source for join — out of scope for this ticket)
      - Pipeline sharing (analogous to dashboard sharing) — currently
        every pipeline read is owner-only
      - PostgreSQL RLS layer as belt-+-suspenders defense in depth
- [ ] Update `README` / `CONTRIBUTING.md` if any contributor-facing pattern
      changed
- [ ] Run `openspec archive repo-acl-enforcement`
- [ ] Gates: full suite, archive cleanup

## Acceptance criteria (ticket-level)

1. [ ] Every ACL'd repo's public reads accept caller identity and enforce ACL in SQL
2. [ ] No service method still has `if (resource.ownerId != user.id) Forbidden` against an ACL'd repo
3. [ ] `dataTypeRepo.findById(id)` (unscoped overload) deleted or renamed to `*Internal` with documented callers
4. [ ] For every repo: a regression test asserts "wrong user gets None"
5. [ ] Cross-user `GET /api/types/:id` (was HEL-268) closes — route-level test
6. [ ] Dashboard / panel sharing continues to work — HEL-36 semantics preserved
7. [ ] No behavior changes for owners reading their own resources
8. [ ] All gates pass (sbt test, lint, format, jest, build, scala-quality, openspec validate)
9. [ ] Performance: EXPLAIN check confirms the new JOIN/EXISTS doesn't blow up
10. [ ] Pipeline tables gain `owner_id` (V32) and all pipeline endpoints enforce ownership
