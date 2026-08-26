# Files modified — HEL-471

- `backend/src/main/resources/db/migration/V91__audit_events.sql` — new migration: `audit_events`
  table, statement-level `BEFORE UPDATE OR DELETE`/`BEFORE TRUNCATE` append-only triggers
  (`ENABLE ALWAYS`), row-level trigger (defence-in-depth), defence-in-depth REVOKE, and the
  three-policy RLS split (owner `FOR SELECT`, permissive `FOR UPDATE`/`FOR DELETE`).
- `backend/src/main/scala/com/helio/domain/model/model.scala` — adds `AuditEventId`, `AuditSource`,
  `AuditEvent` (+ its `NewAuditEvent` pre-persist projection).
- `backend/src/main/scala/com/helio/infrastructure/persistence/audit/AuditEventRepository.scala` —
  new Slick repository: `append` (privileged pool), `findByActor`/`findByResource` (app pool, caller
  as RLS context user). Exposes no update/delete operation.
- `backend/src/main/scala/com/helio/services/audit/AuditService.scala` — new `AuditService.record`,
  isolating both failed-`Future` and synchronous-throw failures from the caller.
- `backend/src/main/scala/com/helio/api/protocols/audit/AuditEventProtocol.scala` — new, minimal
  `AuditEventResponse` JSON formatter (no route consumes it yet).
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in `AuditEventProtocol`.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `AuditEventRepository`/
  `AuditService` at the server construction root. No route/directive/service call site added.
- `backend/src/test/scala/com/helio/infrastructure/persistence/audit/AuditEventsAppendOnlySpec.scala`
  — new: demonstrates append-only across both pools/roles, three row classes, both revoke phases,
  the post-GRANT case, the positive INSERT/SELECT/CHECK control, and TRUNCATE.
- `backend/src/test/scala/com/helio/infrastructure/persistence/audit/AuditEventRepositorySpec.scala`
  — new: `append`/`findByActor`/`findByResource` behaviour, RLS read-scoping (including the
  RLS-context-user-is-the-caller-not-the-filter-argument case), and the Decision 4 model-shape
  check — all scoped to per-run-unique actor/resource values.
- `backend/src/test/scala/com/helio/services/audit/AuditServiceSpec.scala` — new: failure isolation
  (failed `Future` and synchronous throw), field pass-through, and null-actor system-event recording.
- `openspec/changes/audit-event-append-only-store/evidence.md` — new: captured RED transcripts for
  tasks.md 5.6/5.6b (all-triggers-dropped and statement-level-trigger-only-dropped), the 6.3
  naive-`.recover`-only red, and the 6.5 scope-isolation grep output.
- `openspec/changes/audit-event-append-only-store/tasks.md` — all tasks marked complete.

No route, directive, or existing service file is modified or added by this change (Decision 4 /
tasks.md 6.5). A raw `git diff origin/main...HEAD | grep -i -e ratelimit -e rate_limit` is NOT
empty — it matches the literal example action string `ratelimit.trip` in test data and design.md's
own required documentation of the HEL-495 relationship (Decision 4 explicitly requires stating this
in writing). The actual scope-isolation claim — no import of/dependency on `RateLimitDirective` or
`com.helio.services.ratelimit` — is verified separately in evidence.md and is genuinely empty.
