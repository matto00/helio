# Files modified — cycles 1 + 2 + 3 + 4

## Cycle 1 — investigation + design (no production code)

- `openspec/changes/repo-acl-enforcement/proposal.md` — concise problem
  framing, what changes, what's out of scope, and the high-level sub-PR
  plan.
- `openspec/changes/repo-acl-enforcement/design.md` — Q1 per-callsite
  owned-vs-shared assignment, Q2 app-JOIN vs RLS trade-off, Q3 sub-PR
  split rationale, Q4 backward-compat strategy, risks + mitigations.
- `openspec/changes/repo-acl-enforcement/tasks.md` — six cycles total
  (cycle 1 = this one; CS1-CS5 in cycles 2-6) with per-task checklists.
- `openspec/changes/repo-acl-enforcement/executor-report-1.md` — full
  audit: repo public surface table, service-side ACL surface table,
  route-level surface table, test surface inventory, performance
  considerations, surfaced risks, recommendation.

## Cycle 2 (PR/CS1) — Pipeline `owner_id` foundation

Pure additive. No behavior change. Every existing caller of
`pipelineRepo.findById(id)` continues to compile and run unchanged.

- `backend/src/main/resources/db/migration/V32__pipelines_owner.sql` —
  new Flyway migration. Adds `owner_id UUID NOT NULL DEFAULT
  '00000000-0000-0000-0000-000000000001'::uuid REFERENCES users(id)` to
  `pipelines`, plus `idx_pipelines_owner_id`. Comment block explains the
  system-user backfill + production deployment caveat.
- `backend/src/main/scala/com/helio/domain/model.scala` — `Pipeline` case
  class gains `ownerId: UserId`. The field is appended (not inserted) to
  minimize call-site disruption; only `SparkJobSubmitterSpec`'s
  `makePipeline` helper required a touch.
- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala`
  — `PipelineRow` + `PipelineTable` gain an `ownerId: UUID` column
  (matches the `Option[UUID]`→`UUID` Slick pattern used by
  `DashboardRepository`). `findById` delegates to new
  `findByIdInternal`; both are equivalent today (the divergence lands in
  CS2 per design.md Q4). `create()` persists the supplied owner.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — registers
  `ResourceType("pipeline", id => pipelineRepo.findByIdInternal(...).map(...))`
  in the `ResourceTypeRegistry` so a future PipelineRoutes refactor (CS2 /
  CS5) can lean on `AclDirective`. `PipelineId` added to the existing
  domain import alphabetical group.
- `backend/src/test/scala/com/helio/infrastructure/PipelineRepositorySpec.scala`
  — adds a new `PipelineRepository owner_id (V32)` suite covering the
  five tasks listed in the cycle 2 scope: default-backfill, explicit
  owner via `create()`, `findByIdInternal` returns regardless of owner,
  registry resolver round-trip (owner present), registry resolver returns
  `None` for unknown id.
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` —
  `makePipeline` test helper now supplies the new `ownerId` field
  (system user id literal; `ownerId` `String` is defined inside a sibling
  helper and is intentionally not promoted to the enclosing scope).
- `openspec/changes/repo-acl-enforcement/tasks.md` — Cycle 2 (PR/CS1)
  checkboxes flipped to `[x]`.
- `openspec/changes/repo-acl-enforcement/executor-report-2.md` — this
  cycle's summary (new).
- `openspec/changes/repo-acl-enforcement/files-modified.md` — this file
  (now spans cycles 1 + 2 + 3).

## Cycle 3 (PR/CS2) — Pipeline ACL enforcement

Closes HEL-271 (P0). The pipeline surface — `pipelines`, `pipeline_steps`,
`pipeline_runs`, and every route built on them — now refuses to return,
mutate, run, or delete rows the caller does not own. Owner read paths are
unchanged in behavior; only cross-user requests transition from 200/204 to
404.

### Backend — repository layer

- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala`
  — every public method gains a `user: AuthenticatedUser` parameter and
  filters on `owner_id = :user`. `exists`, `findById`, `findSummaryById`,
  `delete`, `updateName`, `updateLastRun`, `listSummaries`, and `create`
  are all owner-scoped. `create` invokes the new
  `dataSourceRepo.findByIdOwned` to gate the source binding. Adds
  `findByIdInternal` (kept) and `updateLastRunInternal` (new) as the two
  documented privileged escape hatches; the latter is used only by
  `SparkJobSubmitter`. (213L → 264L; under soft budget.)
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala`
  — every read / write JOINs against `pipelines.owner_id`. `listByPipeline`
  and `findById` use a Slick comprehension; `update` and `delete` resolve
  the ownership predicate first, then mutate. The on-disk shape of
  `pipeline_steps` is unchanged. (138L → 171L.)
- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala`
  — owner-scoped reads (`listByPipeline`) and writes (`insertRun`,
  `insertDryRun`, `updateRunTerminal`, `deleteOldRuns`, `deleteOldDryRuns`)
  via JOIN to `pipelines.owner_id`. Each owner-scoped write delegates to a
  matching `*Internal` variant that the privileged Spark driver path
  (`SparkJobSubmitter`) calls directly with documented justification.
  (133L → 201L.)
- `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala`
  — adds `findByIdOwned(id, user)` as the seed for CS3. The existing
  unscoped `findById` stays in place this cycle (CS3 collapses it). This is
  the only DataSource-side change in CS2's scope. (175L → 192L.)

### Backend — service layer

- `backend/src/main/scala/com/helio/services/PipelineService.scala` — every
  public method takes `user`; `listSummaries`, `findSummaryById`,
  `updateName`, `delete`, `listSteps`, `addStep`, `updateStep`,
  `deleteStep` thread the user down to the owner-scoped repo calls. The
  pipeline-existence gates on step CRUD become owner-scoped existence
  checks. (297L → 297L; signature changes only.)
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` —
  every public method (`submit`, `previewStep`, `history`,
  `pipelineExists`) takes `user`. The `executeRun` / `onDryRunSuccess` /
  `onRunSuccess` private helpers thread the user through to the
  owner-scoped run-record writes and the `pipelineRepo.updateLastRun`
  housekeeping. The DataSource read for the source binding is left
  unscoped (`dataSourceRepo.findById`) with an inline comment explaining
  why: the pipeline ACL is the authoritative gate, and join-target sources
  may legitimately belong to a different user — flagged spinoff. (323L →
  341L; over soft budget pre-existing.)

### Backend — Spark driver

- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` —
  switches `insertRun` / `deleteOldRuns` / `updateRunTerminal` /
  `updateLastRun` to the explicit `*Internal` variants. Inline comment
  documents that the privileged background driver does not carry a
  request-bound user; the pipeline ACL was checked at `submit` time by
  `PipelineRunService.submit`. (213L → 220L.)

### Backend — routes

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — passes
  `authenticatedUser` to the five pipeline route constructors that
  previously took no user (`PipelineStepRoutes`, `PipelineRunSubmitRoutes`,
  `PipelineRunStatusRoutes`, `PipelineRunHistoryRoutes`,
  `PipelineRunStreamRoutes`). One-line change per constructor. (170L →
  170L.)
- `backend/src/main/scala/com/helio/api/routes/PipelineRoutes.scala` —
  threads `user` to the four service calls that newly require it.
- `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala` —
  constructor gains `user`; every service call threads it.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunSubmitRoutes.scala`
  — constructor gains `user`; threaded to `runService.submit`.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunStatusRoutes.scala`
  — constructor gains `user`; threaded to `runService.previewStep`.
  `runService.status` is cache-only and stays user-agnostic.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunHistoryRoutes.scala`
  — constructor gains `user`; threaded to `runService.history`.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunStreamRoutes.scala`
  — constructor gains `user`; threaded to `runService.pipelineExists`
  (the SSE guard).

### Backend — tests

- `backend/src/test/scala/com/helio/api/routes/PipelineAclSpec.scala` —
  new. Seeds two distinct users (A + B); composes the full pipeline
  route surface per user; asserts every cross-user GET / PATCH / DELETE /
  step CRUD / run / preview / history / SSE endpoint returns 404; asserts
  the create-time source binding check returns 404 (not 400); asserts
  owner success paths still work as regression guards. 14 tests across
  9 `should` blocks. (388L — over soft budget; a single new file is
  preferable to spreading cross-user assertions across the existing
  spec files where they would not cohere.)
- `backend/src/test/scala/com/helio/infrastructure/PipelineRepositorySpec.scala`
  — extends with the `PipelineRepository cross-user ACL (CS2)` suite:
  `findById` / `findSummaryById` / `exists` / `listSummaries` /
  `updateName` / `delete` / `updateLastRun` all return `None` / false /
  no-op for a non-owner; `findByIdInternal` still sees the row;
  `create` rejects a non-owned source. Plus the existing-test signature
  updates for the new `user` parameters. (211L → 303L; +9 tests.)
- `backend/src/test/scala/com/helio/infrastructure/PipelineStepRepositorySpec.scala`
  — extends with the `PipelineStepRepository cross-user ACL (CS2)` suite:
  `listByPipeline` / `findById` / `update` / `delete` all return empty /
  None / false for a non-owner. Plus signature updates. (123L → 167L;
  +4 tests.)
- `backend/src/test/scala/com/helio/infrastructure/PipelineRunRepositorySpec.scala`
  — extends with 5 cross-user assertions (CS2 tag): `listByPipeline`
  filters; `insertRun` / `insertDryRun` / `updateRunTerminal` /
  `deleteOldRuns` are all silent no-ops for non-owners. Plus signature
  updates. (238L → 290L; +5 tests.)
- `backend/src/test/scala/com/helio/infrastructure/DataSourceRepositorySpec.scala`
  — adds three tests covering the new `findByIdOwned` method (owner /
  non-owner / unknown id). (174L → 202L.)
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala`
  — updates the `makeRoutes` helper to pass `dummyUser` to the four run
  route constructors; converts the few existing repo calls to thread
  `dummyUser`. No semantic change; existing test cases continue to assert
  the same wire shapes.
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` —
  threads `dummyUser` into the `PipelineStepRoutes` constructor.
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` —
  swaps `pipelineRepoForSubmit.findById(pid)` → `findByIdInternal(pid)`
  in the persistence assertions (the spec's whole point is to verify the
  privileged background driver writes the right rows; the privileged
  read variant is the correct test counterpart), and threads the system
  user into `pipelineRunRepoForSubmit.listByPipeline` reads.

### OpenSpec bookkeeping

- `openspec/changes/repo-acl-enforcement/tasks.md` — Cycle 3 (PR/CS2)
  checkboxes flipped to `[x]`.
- `openspec/changes/repo-acl-enforcement/executor-report-3.md` — this
  cycle's summary (new).
- `openspec/changes/repo-acl-enforcement/files-modified.md` — this file
  (now spans cycles 1 + 2 + 3).

## Cycle 4 (PR/CS3) — DataType + DataSource ACL enforcement

Closes HEL-256 / HEL-268 / HEL-242 leaks. Collapses the awkward
`findById(id)` + `findById(id, ownerId)` overload pair on
`DataTypeRepository`; renames the unscoped `DataSourceRepository.findById`
to `findByIdInternal`; wires owner-scoped reads throughout
`DataTypeService`, `DataSourceService`, `SourceService`, and
`PanelService.resolveSingleBinding`. Cross-user calls now return 404,
not 403.

### Backend — repository layer

- `backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala`
  — `findById(id)` renamed to `findByIdInternal` (documented privileged
  callers); `findById(id, ownerId)` renamed to `findByIdOwned(id, user:
  AuthenticatedUser)`; `isBoundToAnyPanel` replaced by
  `existsBoundToAnyOwnedPanel(id, user)` (owner-scoped COUNT).
- `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala`
  — `findById(id)` renamed to `findByIdInternal` with documented privileged
  callers; `findByIdOwned` (CS2 seed) stays in place.

### Backend — service layer

- `backend/src/main/scala/com/helio/services/DataTypeService.scala` —
  `findById`, `listRows`, `validateExpression` now require `user` and call
  `findByIdOwned`; `update`/`delete` collapse `requireOwnerOnly` + `findById`
  to a single `findByIdOwned`; `checkSourceLink` uses `findByIdInternal`
  (documented: error-message rendering, no data leak); `accessChecker`
  removed from constructor.
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` —
  `update`, `delete`, `refresh`, `preview` collapse `requireOwnerOnly` +
  `findById` to a single `findByIdOwned`; `accessChecker` removed from
  constructor.
- `backend/src/main/scala/com/helio/services/SourceService.scala` — `refresh`
  and `preview` collapse the manual `source.ownerId != user.id` guard +
  `findById` to `findByIdOwned`.
- `backend/src/main/scala/com/helio/services/PanelService.scala` —
  `resolveSingleBinding` switches from `findById(typeId, user.id)` (old
  2-arg overload) to `findByIdOwned(typeId, user)`.
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` —
  source lookups in `submit`/`previewStep` and `upsertFieldsFromRows` switch
  to `findByIdInternal` (privileged; documented).

### Backend — routes + domain

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — registry
  resolvers for `data-source` and `data-type` switch to `*Internal` variants
  (documented privileged callsite); service constructors updated.
- `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala` —
  `listRows`, `validateExpression`, and GET route calls now pass `user`.
- `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala` — switches
  to `findByIdInternal` (privileged: cross-user join source spinoff per
  design.md Q1).
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — JoinStep
  case switches to `findByIdInternal` (privileged: background Spark driver).

### Backend — tests

- `backend/src/test/scala/com/helio/api/routes/DataTypeDataSourceAclSpec.scala`
  — NEW. 24 tests: cross-user 404 on GET/PATCH/DELETE types; GET/PATCH/
  DELETE/refresh/preview data-sources; list is owner-scoped; repo-level
  `findByIdOwned` and `existsBoundToAnyOwnedPanel` assertions; same-user
  200 paths as regression guards.
- `backend/src/test/scala/com/helio/infrastructure/DataTypeRepositorySpec.scala`
  — updated `findById` → `findByIdInternal`; added `findByIdOwned` (owner
  match, mismatch, unknown) and `existsBoundToAnyOwnedPanel` (false when
  no panels) tests.
- `backend/src/test/scala/com/helio/infrastructure/DataSourceRepositorySpec.scala`
  — updated `findById` → `findByIdInternal`; description cleanup.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — 4 existing
  403 assertions updated to 404 (DELETE/preview on data-sources, PATCH/DELETE
  on types).
- `backend/src/test/scala/com/helio/api/routes/DataTypeRoutesSpec.scala` —
  dropped unused `AccessCheckerImpl`/`ResourceTypeRegistry` wiring; service
  constructor updated.
- `backend/src/test/scala/com/helio/services/DataTypeServiceSpec.scala` —
  dropped `accessChecker`; `findById` → `findByIdInternal`.
- `backend/src/test/scala/com/helio/services/DataSourceServiceSpec.scala` —
  dropped `accessChecker`.
- `backend/src/test/scala/com/helio/services/DataSourceServiceRestartPersistenceSpec.scala`
  — dropped `accessChecker`; `findById` → `findByIdInternal`.
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala`
  — `dtRepo.findById` → `findByIdInternal`.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala`
  — mock `findById` override → `findByIdInternal`.

### OpenSpec bookkeeping

- `openspec/changes/repo-acl-enforcement/tasks.md` — Cycle 4 (PR/CS3)
  checkboxes flipped to `[x]`.
- `openspec/changes/repo-acl-enforcement/executor-report-cs3.md` — CS3
  executor summary (new).
- `openspec/changes/repo-acl-enforcement/files-modified.md` — this file
  (now spans cycles 1–4).
