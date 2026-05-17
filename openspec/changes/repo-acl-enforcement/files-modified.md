# Files modified — cycles 1 + 2

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
  (now spans cycles 1 + 2).
