## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 ticket ACs addressed explicitly: CRUD via authenticated/owner-scoped routes, write-time
  cron/interval/timezone rejection with clear messages, V62 migration + RLS mirroring V35, schemas
  + openspec updated, meaningful CRUD/validation/RLS tests, backward compatibility (verified live —
  existing pipeline `analyze` endpoint unaffected by an unscheduled pipeline).
- No AC reinterpreted. `next_run_at`/scheduler firing correctly deferred to HEL-415 per design.md
  Non-Goals and ticket's own Out-of-scope list — not penalized per orchestrator batch-context note.
- All 16 tasks.md items marked done; each traces to a real, verified artifact (migration, domain
  model, repository, service, protocol, routes, wiring, schemas, tests).
- No scope creep: touched files are exactly what the proposal's Impact section describes, plus the
  required `RlsPolicyGuardSpec` allowlist addition and a `CLAUDE.md` endpoint-list line.
- No regressions to existing behavior: full backend suite (1670 tests) passes; live curl exercise
  confirms `/api/pipelines/:id/analyze` unaffected.
- Schemas (`schemas/pipeline-schedule.schema.json`, `schemas/put-pipeline-schedule-request.schema.json`)
  and `openspec/changes/.../specs/` added; `npm run check:schemas` passes (17 checked).
- Planning artifacts (proposal/design/tasks) match the final implementation; skeptic's design-gate
  CONFIRM (round 1) non-blocking note about PUT status-code consistency (200 vs 201 across
  create/replace) resolved cleanly — `ServiceResponse.run` defaults to 200 for both paths, verified
  live.

### Phase 2: Code Review — PASS
Issues: none.

- Mirrors the `AlertRuleService`/`AlertRuleRepository`/`AlertRuleRoutes`/`AlertRuleProtocol`
  pattern faithfully; migration mirrors V35's indirect-owner RLS shape byte-for-byte (verified via
  diff against `V35__rls_owner_only_tables.sql`).
- `check:scala-quality` clean — no inline FQN violations in the new files (only pre-existing soft
  file-size warnings elsewhere in the codebase; the two new test files exceed the 250-line soft
  budget but that's informational-only per CONTRIBUTING.md and consistent with existing test-file
  norms).
- DRY: reuses `ServiceError`, `ServiceResponse`, `PipelineRepository.findByIdOwned`,
  `PipelineIdSegment`, `DbContext.withUserContext` — no reinvented plumbing.
- Readable: cron/interval validators are self-documenting with named bounds
  (`cronFieldBounds`), clear per-field error messages.
- Modular: repository/service/routes/protocol cleanly separated; routes are a thin HTTP shell with
  all logic in the service.
- Type safety: value-class IDs (`PipelineScheduleId`), `ScheduleKind` sealed trait — no raw-string
  leakage into repository/service signatures.
- Security: RLS FORCE-enabled + app-layer ACL double-gate (`pipelineRepo.findByIdOwned` before
  every repository call); CSRF header enforced (verified live); input validated at the service
  boundary before persistence.
- Error handling: `Either[ServiceError, A]` at every service boundary; 404s for not-found/not-owned
  (existence not leaked), 400s for validation failures — no silent failures.
- Tests meaningful: `PipelineScheduleRepositorySpec` (CRUD, RLS-exclusion, upsert-replace,
  cascade-delete), `PipelineScheduleServiceSpec` (valid/invalid cron/interval/timezone,
  enabled-normalization, ACL), `PipelineScheduleRoutesSpec` (full HTTP-layer AC/spec-scenario
  coverage including cross-user 404s) — independently re-run, all pass (91/91 targeted, 1670/1670
  full suite).
- No dead code, no TODO/FIXME.
- No over-engineering: hand-rolled structural validation (no new cron library) matches design.md's
  explicit, self-approved scope decision.
- N/A structural-refactor behavior-preservation check (this is additive-only, no refactor).

### Phase 3: UI Review — PASS
Issues: none (backend-only ticket; no frontend files touched, but `ApiRoutes.scala` and `schemas/`
changes trigger this phase per the checklist).

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — both reused
already-healthy servers, PASS. Live-exercised the full route surface with curl against the running
backend (port 8494), independent of the executor's self-report:

- `GET` on an owned pipeline with no schedule → 404.
- `PUT` valid cron (with required CSRF header) → 200 with the created schedule; subsequent `GET`
  round-trips identical `kind`/`expression`/`enabled`/`timezone`.
- `PUT` invalid cron (`"bad cron"`) → 400 with a message naming the field count.
- `PUT` invalid interval (`"5x"`) → 400 with a message naming the expected `<n><unit>` shape.
- `PUT` invalid timezone (`"Fake/Zone"`) → 400 with a message identifying the bad timezone.
- Cross-user (`userB`) `GET`/`PUT`/`DELETE` against `userA`'s pipeline → 404 in all three cases; a
  follow-up `GET` as `userA` confirms nothing was created/mutated/deleted by the cross-user attempt.
- `DELETE` as owner → 204; subsequent `GET` → 404.
- Unknown pipeline id → 404.
- Frontend (port 5587) loads with zero console errors (no UI surface for this ticket, sanity check
  only — confirms `ApiRoutes.scala`'s route-tree change didn't break app boot).

### Overall: PASS

### Non-blocking Suggestions
- `schemas/pipeline-schedule.schema.json` lists `nextRunAt`/`lastRunAt` as `required` with type
  `["string", "null"]`. Live wire capture shows spray-json actually *omits* these keys entirely when
  `None` (confirmed via curl — the response contained no `nextRunAt`/`lastRunAt` key at all when
  unset), not `null`. This mirrors an existing precedent (`schemas/alert-event.schema.json`'s
  `resolvedAt`/`acknowledgedAt`/`snoozedUntil`, same discrepancy) and isn't caught by
  `check:schemas` (field-name-only parity check), so it isn't a regression this ticket introduced —
  flagging for a possible follow-up schema-tooling fix across both, not a blocker for this change.
