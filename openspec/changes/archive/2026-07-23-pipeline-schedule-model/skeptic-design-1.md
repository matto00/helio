## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **V62 is genuinely the next available Flyway version.** `ls backend/src/main/resources/db/migration/` shows `V61__alert_events.sql` is the latest on disk; `git log --oneline -5` confirms HEAD (`0969fa66`) is the just-merged alert chain the ticket cites. The design's "verified at scheduling time" claim checks out.
- **Indirect-owner RLS pattern (V35) is real and matches the design's description.** Read `backend/src/main/resources/db/migration/V35__rls_owner_only_tables.sql` in full — `pipeline_steps_owner`/`pipeline_runs_owner` use `ENABLE`/`FORCE ROW LEVEL SECURITY` + an `EXISTS` subquery against `pipelines.owner_id`, exactly as design.md Decision 2 and the persistence spec describe. Not a hallucinated precedent.
- **`AlertRuleService`/`Repository`/`Routes`/`Protocol` exist and match the shape being mirrored.** Read `AlertRuleService.scala` in full: `findByIdOwned`-gated update/delete, `req.enabled.getOrElse(true)` normalization, `ServiceError.NotFound`/`BadRequest` shapes — all real, not invented. `grep -n findByIdOwned backend/.../PipelineRepository.scala` confirms the target-ownership check design.md Decision 4 cites also exists.
- **Nested route convention is established.** `grep -rn PipelineIdSegment backend/src/main/scala/com/helio/api/routes/` shows `PipelineStepRoutes`, `PipelineRunSubmitRoutes`, etc. all use `pathPrefix("pipelines" / PipelineIdSegment / "<subresource>")` — the proposed `.../schedule` route follows this exactly.
- **`id TEXT PRIMARY KEY` is the universal table convention.** Checked `V23__pipeline_steps.sql` and `V60__alert_rules.sql` — both confirm Decision 3's claim.
- **Two-capability spec split has precedent.** `ls openspec/specs/` shows `alert-rule-persistence` + `alert-rule-crud-api` as the direct analog to this change's `pipeline-schedule-persistence` + `pipeline-schedule-crud-api`; no name collisions with existing specs (`pipeline-*`, `alert-*` all checked).
- **`ScheduleKind` enum precedent exists.** `grep -n "sealed trait Severity"` in `model.scala` confirms the enum-mirroring pattern tasks.md 2.1 proposes is real.
- **No placeholders.** `grep -rniE "TODO|TBD|figure out|placeholder|xxx"` across the whole change dir returned nothing.
- **AC → task → spec traceability**, checked ticket.md against tasks.md and both spec files:
  - CRUD + owner-scoping → tasks 2–4, both specs' scenarios.
  - Invalid cron/interval rejected at write time → tasks 3.2/3.3, crud-api spec "Invalid cron/interval/timezone" scenarios.
  - Migration applies cleanly + RLS parity → task 1, persistence spec scenarios.
  - schemas/openspec updated → task 5.
  - Tests (CRUD, validation, RLS/ownership) → task 6 (repo/service/routes specs).
  - Backward compatible → explicit "Backward compatibility" requirement in crud-api spec + design Non-Goals.
  All six ACs trace to concrete artifacts; none is left uncovered.
- **Batch-context scope boundary respected.** design.md Non-Goals explicitly and correctly excludes `next_run_at` computation/scheduler firing, and the persistence spec has an explicit requirement ("SHALL NOT derive next_run_at") rather than silently omitting it — this is the correct, honest way to encode the HEL-415 boundary, not a gap.

### Verdict: CONFIRM

### Non-blocking notes
- `specs/pipeline-schedule-crud-api/spec.md:30` allows "200 or 201" for a successful PUT create. This is a deliberately permissive scenario (matches the upsert design), not a genuine ambiguity that blocks implementation — but the executor should pick one and stay consistent across the two scenarios (create vs. replace).
- `.openspec.yaml` created date is `2026-07-23`, one day ahead of the stated current date (`2026-07-22`). Cosmetic only.
