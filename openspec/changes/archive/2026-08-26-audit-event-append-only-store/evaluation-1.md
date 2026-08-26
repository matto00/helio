## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket acceptance criteria addressed explicitly: migration creates `audit_events` with the
  specified columns/indexes; append-only demonstrably fails loudly (23001) on the app pool AND is
  explicitly reasoned about (and tested, two-phase) on the privileged pool; `AuditService.record`
  isolates both failed-Future and synchronous-throw failures; ScalaTest coverage exists for the
  repository, the append-only trigger, and the service.
- No AC silently reinterpreted. The `actor_token_id` FK-vs-soft-reference deviation from the
  ticket's literal "FK-soft to `api_tokens`" phrasing is explicitly reasoned in the migration
  header comment (V91:66-83) and matches exactly the rationale given by the orchestrator context
  (TRUNCATE CASCADE hazard across ~15 unrelated harnesses) — this is faithful to "soft reference",
  not a scope reinterpretation; the ticket phrase itself says "FK-soft", which a hard FK with
  `ON DELETE SET NULL` would not have honored anyway (TRUNCATE CASCADE ignores ON DELETE action).
- Task list (tasks.md) shows 37/37 items checked, 0 unchecked, and matches what's implemented.
- No scope creep: `git diff main...HEAD -- backend/src | grep -i "RateLimitDirective\|com.helio.services.ratelimit"` returns empty (confirmed independently). No route/directive file is modified. `files-modified.md` accurately lists all 13 touched files.
- No regressions: full backend suite (3418 tests) passes.
- API contracts: `AuditEventProtocol`/`JsonProtocols` additions are minimal per design (no route
  consumes them yet), consistent with ticket scope.
- Planning artifacts (design.md, spec deltas) reflect final implemented behavior — migration,
  repository, and tests match design.md's six decisions point-for-point (statement-level
  `ENABLE ALWAYS` trigger, separate TRUNCATE trigger, three-policy RLS split, soft actor_token_id,
  privileged-pool writes / owner-scoped reads, per-run-unique test isolation).

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` requested this cycle):
- `sbt clean compile`: succeeds. 11 pre-existing warnings, all in files untouched by this diff
  (`ApiRoutes.scala`, `SchemaInferenceEngine.scala`, `RefinementService.scala`,
  `DashboardAuthoringService.scala`, `WorkspaceContextService.scala`) — none introduced by HEL-471.
- `sbt test`: **3418 tests, 0 failed, 0 canceled** (218 suites), including the new
  `AuditEventsAppendOnlySpec` (16 append-only cases), `AuditEventRepositorySpec`, and
  `AuditServiceSpec` (4 cases). Migration V91 applies cleanly (Flyway log: "Successfully applied
  91 migrations to schema public, now at version v91").

Checklist:
- **Migration mechanics verified directly by reading V91__audit_events.sql**: statement-level
  `BEFORE UPDATE OR DELETE ... FOR EACH STATEMENT` trigger (`audit_events_no_mutation_stmt`),
  promoted `ENABLE ALWAYS` (line 116); separate `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger
  (`audit_events_no_truncate`), also `ENABLE ALWAYS` (line 136); row-level trigger retained as
  defence-in-depth only (lines 121-126); three-policy RLS split — owner `FOR SELECT` (164-166),
  permissive `FOR UPDATE USING (true)` (168-169), permissive `FOR DELETE USING (true)` (171-172) —
  not a single `FOR ALL` policy; `REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC` and
  `FROM helio_privileged` both name explicit grantees (145-146). All match design.md exactly.
- **`AuditEventsAppendOnlySpec` verified directly**: every UPDATE/DELETE is issued with a targeted
  `WHERE id = $id::uuid` (never a bare column-free statement); all three row classes are covered —
  caller-owned (190-203), other-user-owned (205-218), NULL-actor (220-233); the privileged-pool
  section is genuinely two-phase — phase (a) asserts 42501 with the V91 revoke still in place
  (237-250), phase (b) re-GRANTs on the superuser connection then asserts 23001 (252-268), not
  collapsed to "any database error"; a distinguishing case re-GRANTs full DML to the app role and
  still asserts 23001 (272-286); TRUNCATE is issued on the owner/superuser connection, not the
  non-owner harness role (290-301).
- **`evidence.md` transcripts read and cross-checked against design.md's required red shapes**:
  5.6 (all triggers dropped) shows `affected=0` for other-user/NULL-actor rows and `affected=1` for
  caller-owned rows on the app pool, `permission denied` (42501) for phase (a), `affected=1` for
  phase (b) post-re-GRANT, and `affected=0` for the 5.4 distinguishing case and for TRUNCATE — this
  is exactly the differentiated red pattern design.md's Testing-strategy item 6 requires, not a
  uniform "any error" outcome. 5.6b (only the statement-level trigger dropped, row-level trigger +
  all three policies intact) shows `affected=0` for both targeted cases against invisible rows —
  the specific observation that isolates the statement-level trigger as load-bearing, distinct from
  the row-level trigger + RLS combination. 6.3's naive-`.recover`-only red shows the synchronous
  throw propagating uncaught. These transcripts are internally consistent with the mechanism and
  plausible as genuine captures (SQLSTATEs, row-affected counts, and UUIDs are the kind of detail a
  narrated-not-run transcript would be unlikely to get right in combination). Full independent
  reproduction of the red state was not performed (would require standing up a second scratch
  Postgres and reverting the migration) — this is a reasonableness read of the artifact, not a
  live re-derivation.
- **`AuditServiceSpec` covers both failure modes** (44-56): a `FailingFutureRepository` (async
  failed Future) and a `ThrowingRepository` (synchronous throw before any Future is produced).
  `AuditService.record`'s implementation uses `Future(auditEventRepo.append(event)).flatten` (an
  eager guard — line 47 of `AuditService.scala`), which is exactly what makes the throwing case
  recoverable; a bare `.recover` on `append(event)`'s result would not catch the synchronous throw,
  as the code comment states and as `evidence.md`'s 6.3 capture demonstrates.
- Decision 6 (test isolation): both new specs use fresh `UUID.randomUUID()` for actor/resource
  values per test/run; no absolute `count(*)`, "returns all rows", or "table is empty" assertions
  found in either spec.
- No inline fully-qualified names found in the new/modified Scala files (grepped).
- No FK from `audit_events.actor_token_id` to `api_tokens`; migration documents the
  TRUNCATE-CASCADE rationale in detail (V91:66-83) — sound and consistent with the ticket's
  "FK-soft" phrasing and the orchestrator-supplied context about the 264-test regression this
  avoided.
- Repository (`AuditEventRepository.scala`) is modular, reuses the `jsonbStringType`/
  `instantColumnType` pattern from sibling repositories (comment cites `AlertRuleRepository`/
  `DataSourceRepository`), exposes no update/delete method, and correctly pins `callerUserId` as
  the RLS context argument (never the filter argument) in both `findByActor` and `findByResource`,
  matching design.md Decision 2's stated hazard.
- `Main.scala` wiring is additive only — constructs `AuditEventRepository`/`AuditService` but does
  not call `.record` from any route/directive, matching Decision 4/6.5's scope constraint.
- DRY / readable / modular / typed / dead-code checks: no unused imports, no TODO/FIXME, no `Any`
  or untyped escape hatches, small composable methods throughout.

### Phase 3: UI Review — N/A

Backend-only ticket; no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`
changes matching the UI-review triggers (the two new spec deltas are `audit-event-persistence` and
`audit-event-recording`, both under `specs/` in the openspec change dir but not
`openspec/specs/**` on trunk — no route wiring exists for this ticket to expose in the UI). Per
task instructions, dev servers were not started and Playwright was not invoked.

### Overall: PASS

### Non-blocking Suggestions

- None significant. The evidence.md red-transcript capture was not independently re-derived live
  by this evaluator (would require standing up a second scratch Postgres instance and reverting
  V91's trigger DDL); the transcripts are internally consistent and plausible but a future cycle
  could increase confidence further by having the evaluator or skeptic reproduce one red case
  directly if time budget allows.
