## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Diff scope**: `git diff main...HEAD --stat` — 27 files, additive-only (no deletions/modifications
  to unrelated behavior), exactly matching proposal.md's Impact section plus the required
  `RlsPolicyGuardSpec` allowlist entry and `CLAUDE.md` endpoint-list line.
- **Migration + RLS**: read `backend/src/main/resources/db/migration/V62__pipeline_schedules.sql`
  in full and diffed it against `V35__rls_owner_only_tables.sql`. Confirms: `pipeline_schedules`
  table with `pipeline_id UNIQUE FK ... ON DELETE CASCADE`, no `owner_id` column, `ENABLE`/`FORCE
  ROW LEVEL SECURITY`, and `pipeline_schedules_owner` policy using an `EXISTS` subquery against
  `pipelines.owner_id` — a byte-for-byte structural match to `pipeline_steps_owner`/
  `pipeline_runs_owner`.
- **Domain/repository/service/protocol/routes**: read all five new/changed files in full
  (`domain/model.scala`, `PipelineScheduleRepository.scala`, `PipelineScheduleService.scala`,
  `PipelineScheduleProtocol.scala`, `PipelineScheduleRoutes.scala`). Faithfully mirrors the
  `AlertRule*`/`Severity` pattern cited in design.md; ACL double-gate
  (`pipelineRepo.findByIdOwned` in the service + RLS in the repository); hand-rolled cron
  (5-field, per-field bounds/wildcard/list/range/step) and interval (`<n><unit>`) validators plus
  `ZoneId.of` timezone validation, matching design.md Decision 5 exactly.
- **Wiring**: `ApiRoutes.scala`/`Main.scala`/`JsonProtocols.scala`/`api/package.scala` diffs
  confirm the nullable-optional-repo wiring pattern used for `alertRuleRepo`/`alertEventRepo` is
  reused correctly; no other route trees touched.
- **Tests — targeted, fresh run**:
  `sbt testOnly com.helio.infrastructure.RlsPolicyGuardSpec com.helio.infrastructure.PipelineScheduleRepositorySpec com.helio.services.PipelineScheduleServiceSpec com.helio.api.routes.PipelineScheduleRoutesSpec`
  → 91/91 pass; Flyway log shows migration 62 ("pipeline schedules") applies cleanly on a fresh
  EmbeddedPostgres instance, "Successfully applied 62 migrations."
- **Tests — full suite, fresh run**: `sbt test` → 1670/1670 pass, 0 failed, 0 canceled. No
  regressions anywhere else in the backend.
- **Lint/quality — fresh run**: `npm run check:scala-quality` → clean (only pre-existing
  file-size soft warnings across the codebase, informational only per CONTRIBUTING.md). Manually
  grepped the full diff for inline `com.helio.*` occurrences outside `import`/`package` lines —
  zero hits (only `package com.helio.api.protocols` etc. declarations and import blocks).
- **Schema sync — fresh run**: `npm run check:schemas` → "schemas in sync with JsonProtocols (17
  checked across 21 protocol files)."
- **Live route verification** (backend already running on :8494 at task start; independently
  exercised, not trusting evaluator's report):
  - Logged in as two distinct real users (existing dev account + a freshly-registered second
    account) against the live DB.
  - `PUT` valid cron as owner → 200 with created schedule; `GET` round-trips identical
    `kind`/`expression`/`enabled`/`timezone`.
  - Cross-user `GET`/`PUT`/`DELETE` against the first user's pipeline schedule, authenticated as
    the second user → 404 in all three cases (`{"message":"Pipeline not found"}`); a follow-up
    `GET` as the owner confirms nothing was created/mutated/deleted by the cross-user attempts —
    existence not leaked, matches spec.
  - Unknown pipeline id → 404.
  - Invalid cron (`"bad cron"`) → 400, message names the field-count mismatch.
  - Invalid interval (`"5x"`) → 400, message names the expected `<n><unit>` shape.
  - Invalid timezone (`"Fake/Zone"`) → 400, message identifies the bad timezone.
  - `DELETE` as owner → 204; subsequent `GET` → 404 (`"Pipeline schedule not found"`).
  - Backward compatibility: `GET /api/pipelines` and `GET /api/pipelines/:id/analyze` on the same
    (now-unscheduled again) pipeline both return normal 200 responses, unaffected by the new
    schedule subresource.
- **Evaluator's non-blocking schema note, independently verified**: live wire capture confirms
  `nextRunAt`/`lastRunAt` keys are entirely *omitted* from the JSON response when unset (not
  serialized as `null`), which contradicts `schemas/pipeline-schedule.schema.json` listing them as
  `required` with type `["string","null"]`. Checked `schemas/alert-event.schema.json` and
  confirmed the identical pre-existing discrepancy on `resolvedAt`/`acknowledgedAt`/
  `snoozedUntil` — this is a pre-existing tooling gap (`check:schemas` only checks field-name
  parity, not JSON presence-vs-null semantics), not a regression introduced by this ticket.
  Correctly non-blocking.
- **AC traceability**: all 6 ticket ACs trace to real, verified artifacts — CRUD+owner-scoping
  (routes+service+repo, live-verified above), invalid-expression rejection (service validators,
  live-verified), migration+RLS parity (V62 read in full, diffed against V35), schemas/openspec
  updated (files present, schema-sync clean), tests (91 targeted + full suite green), backward
  compatibility (live-verified via `/analyze` and pipeline list).
- **Batch-context scope boundary respected**: `next_run_at`/`last_run_at` are persisted-but-never-
  populated by this ticket's code path (confirmed in `PipelineScheduleService.put` — always
  carries forward `existingOpt.flatMap(_.nextRunAt)`/`lastRunAt`, never computes a new value); no
  scheduler/poller/runtime code present anywhere in the diff. Correctly deferred to HEL-415 per
  design.md Non-Goals — not treated as a gap per the orchestrator's batch-context note.
- **No UI changes**: diff touches only `backend/`, `schemas/`, `openspec/`, and `CLAUDE.md` — no
  `frontend/**` files. DESIGN.md / visual review is not applicable to this change.

### Verdict: CONFIRM

### Non-blocking notes
- Pre-existing (not introduced by this ticket) schema/wire-shape discrepancy: `nextRunAt`/
  `lastRunAt` (and the identical pattern on `alert-event.schema.json`'s three nullable-Instant
  fields) are declared `required` in the JSON Schema but are actually omitted from the wire when
  `None`, not serialized as `null`. `check:schemas` doesn't catch this class of drift (name-parity
  only). Worth a follow-up ticket to either fix the schema tooling to check presence-vs-null
  semantics, or make `Option[Instant]` protocol fields consistently serialize `null` instead of
  omitting the key — out of scope for this ticket to fix unilaterally since it would touch the
  pre-existing `AlertEventProtocol` too.
