## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (not from evaluator narrative):
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/agent-memory-persistence/spec.md`, `specs/agent-memory-api/spec.md`) fresh.
- `git log --oneline -3`: `33006d39` (cycle 2 fix) on top of `429c85b8` (cycle 1) on top of
  `281a5899` (HEL-472, merged base). `git diff main...HEAD --stat`: 28 files changed, backend +
  openspec + schema only — no `frontend/**` touched (confirmed via `git diff --stat`, no
  `frontend/` paths present).

**AC-by-AC trace:**
1. "`agent_memory` table via Flyway with owner-only RLS and required indexes" — read
   `backend/src/main/resources/db/migration/V82__agent_memory.sql` directly: `ENABLE`+`FORCE ROW
   LEVEL SECURITY`, single owner policy on `owner_id`, `idx_agent_memory_owner_id` and composite
   `idx_agent_memory_owner_created(owner_id, created_at)` both present, matching design.md
   Decision 2 exactly. Confirmed structurally (not just migration text) by re-running
   `RlsPolicyGuardSpec` and `RlsOwnerTablesSpec`'s `agent_memory` sections myself (see below).
2. "`add` past cap evicts least-recently-useful entry, keeping total at cap, proven by
   ScalaTest" — **this is where cycle 1 had a real bug and I focused extra scrutiny per the
   orchestrator's brief.** Read `AgentMemoryRepository.scala:30-97` line-by-line. The cycle-2 fix
   threads `newRowId` (the just-inserted row's UUID) into `evictIfOverCap`, which filters
   `m.id =!= excludeId` on the eviction-candidate query *before* the `sortBy(lastUsedAt.asc
   .nullsFirst, createdAt.asc).take(1)` selection. This is a **structural** fix, not a
   test-shaped patch: the newly-inserted row is removed from the candidate set entirely, so no
   value of its `lastUsedAt`/`createdAt` (even a tie with an existing row) can ever cause it to
   be selected — it isn't in the query's result set to begin with. I traced the surrounding
   invariants to rule out related edge cases:
   - `count` is computed via `table.filter(_.ownerId === ownerUuid).length.result` *after* the
     insert, in the same transaction — Postgres read-your-own-writes means `count` correctly
     includes the new row, so the `count > cap` boundary triggers exactly at insert #(cap+1), not
     off-by-one (verified against the pre-existing "under the cap" test using cap=5/3 inserts and
     the "past the cap" test using cap=100/101 inserts — both still pass).
   - The eviction delete (`table.filter(_.id === evictId).delete`) doesn't need an explicit
     `ownerId` filter because it runs inside the same `ctx.withUserContext(entry.ownerId.value)`
     transaction — RLS's owner-only `USING` policy is defense-in-depth here even though `evictId`
     was already drawn from an owner-scoped query.
   - The residual concurrent-writer race (two simultaneous `add`s for the same user both reading
     `count <= cap` before either commits) is a **documented, accepted** risk in design.md's
     Risks section, and was already flagged and explicitly accepted (not overlooked) at the
     design gate — see `skeptic-design-1.md:100-107` ("doesn't warrant blocking the design").
     Not a new issue; out of scope for this ticket per that prior review.
   - I independently re-ran the exact regression test cycle 2 added
     (`AgentMemoryRepositorySpec`: "evict an existing entry, never the newly-inserted one, when
     every pre-existing entry has already been touched") plus the full repository/service/route
     suites — all green (see Verification below). I also re-derived the fix's correctness from
     the code itself rather than trusting the executor's/evaluator's commit-message narrative.
3. "`list`/`delete`/`clear`/`touch` behave per spec, RLS-isolated" — read
   `AgentMemoryRepository.scala:37-74` (all methods correctly scoped via `withUserContext`,
   `touch`/`delete` no-op/false on cross-user or unknown id, `clear` returns count). Read
   `RlsOwnerTablesSpec.scala`'s new `agent_memory` section (5 new tests: add-scoped, cross-user
   list denial, cross-user delete denial, cross-user clear denial, privileged-context sees all) —
   seeds via the real repository (not raw SQL), so it proves the actual write path respects RLS,
   not just that the policy exists.
4. "REST endpoints create/list/delete/clear + schema" — read `AgentMemoryRoutes.scala` (mirrors
   `ApiTokenRoutes` shape exactly: `GET`/`POST` on `pathEndOrSingleSlash`, `DELETE` with id
   segment via `AgentMemoryIdSegment`, `DELETE` clear-all), `AgentMemoryProtocol.scala` (DTOs
   decoupled from domain, mixed into `JsonProtocols` per CONTRIBUTING.md's aggregator rule — not
   added directly), `schemas/agent-memory.schema.json` (title matches wire DTO name, `enum` on
   `kind`, `additionalProperties: false`, no `ownerId` leaked). Confirmed schema/protocol parity
   via `node scripts/check-schema-drift.mjs` (fresh run): "schemas in sync ... 57 checked across
   45 protocol files."
5. "Additive; `sbt test` passes; no FQNs inlined" — see Verification below.

**CONTRIBUTING.md's "Adding a new ACL'd table" checklist (4 items), checked one by one:**
1. `ENABLE`+`FORCE ROW LEVEL SECURITY` in the migration — present (V82__agent_memory.sql).
2. Policy covering SELECT/INSERT (and UPDATE/DELETE) — single `USING` policy, matches every
   prior owner-scoped table's established no-`WITH CHECK` convention.
3. `rlsTables` allowlist in `RlsPolicyGuardSpec` — **this was cycle 1's second, mechanical gap**;
   confirmed fixed: `"agent_memory"` added at `RlsPolicyGuardSpec.scala:86-87` with the
   established `// V82 — agent_memory, direct owner (HEL-478 / 420-B)` comment convention. Ran
   `RlsPolicyGuardSpec` fresh myself (below) — the three generated `agent_memory` cases
   (`relrowsecurity`/`relforcerowsecurity`/`has at least one policy`) pass.
4. `idx_<table>_owner_id` — `idx_agent_memory_owner_id` present in the migration.

**Verification (fresh, run myself in `WORKTREE_PATH`, not copied from evaluation-2.md):**
- `sbt "testOnly com.helio.infrastructure.AgentMemoryRepositorySpec
  com.helio.services.AgentMemoryServiceSpec com.helio.api.routes.AgentMemoryRoutesSpec
  com.helio.infrastructure.RlsOwnerTablesSpec com.helio.infrastructure.RlsPolicyGuardSpec
  com.helio.api.ApiRoutesSpec"` → **321/321 passed**, 6 suites, 0 failed — includes the exact
  cycle-2 regression test, all 5 new RLS-isolation cases, and all 4 new composed-route-tree 401
  cases.
- Full `cd backend && sbt test` → **2914/2914 passed**, 189 suites, 0 failed, 0 canceled, 128s —
  matches evaluation-2.md's claimed count exactly (fresh reproduction, not trusted from the
  report). Flyway log confirms migration V82 ("agent memory") applies cleanly to v82.
- `node scripts/check-scala-quality.mjs` → clean; the only warnings are 106 pre-existing,
  unrelated soft-budget (line-count) notices — none on any file this ticket touches.
- `node scripts/check-schema-drift.mjs` → "schemas in sync ... 57 checked across 45 protocol
  files."
- `node scripts/check-openspec-hygiene.mjs` → single expected note ("complete (16/16) but not
  archived") — matches the accepted HEL-472 precedent (archiving is a later delivery phase, not
  a code defect).
- Read `ApiRoutes.scala`/`JsonProtocols.scala`/`Main.scala`/`IdParsing.scala` diffs directly:
  wiring follows the `agentPreferencesServiceOpt`/`AgentPreferencesRoutes` nullable-optional
  pattern exactly (default-`null` repo param, `.fold(reject)` route mount, appended last for
  additivity) — no shortcuts taken.

**No UI review needed** — this is a backend-only ticket (`git diff --name-only main...HEAD |
grep '^frontend/'` → empty; no `frontend/src` references `agent/memory` or `AgentMemory`).
`DESIGN.md`/design-language judgment is out of scope for this change.

### Verdict: CONFIRM

Cycle 1's correctness bug (self-eviction) is fixed with a genuinely structural exclusion, not a
narrow patch aimed at the one reported precondition — I traced the surrounding invariants
(count timing, RLS defense-in-depth, tie-break behavior, the documented-and-accepted concurrent-
writer risk) and found no other eviction-adjacent edge case the fix leaves open. Cycle 1's
mechanical `RlsPolicyGuardSpec` gap is fixed per CONTRIBUTING.md's checklist. All 5 ACs trace to
real, independently-re-run passing evidence (321/321 targeted, 2914/2914 full suite). No scope
creep; no frontend surface to review.

### Non-blocking notes

- Carried over from both evaluator cycles: `IdParsing.scala:31`'s `AgentMemoryIdSegment`
  declaration has slightly different column alignment than its neighbors (cosmetic, no gate
  enforces it).
