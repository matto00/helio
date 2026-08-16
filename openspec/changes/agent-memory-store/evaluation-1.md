## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:

- **AC "`add` past the per-user cap evicts the least-recently-useful entry, keeping the total at
  the cap (proven by a ScalaTest)" is not fully satisfied.** The implementation's eviction query
  can, under a specific and realistic precondition, evict the entry that was *just inserted*
  instead of an existing one — contradicting `specs/agent-memory-persistence/spec.md`'s
  requirement text ("delete exactly one **existing** entry for that owner") and
  `specs/agent-memory-api/spec.md`'s "Creating past the per-user cap evicts the
  least-recently-useful entry" scenario ("the least-recently-useful **existing** entry is
  evicted ... AND the response is still HTTP 201 with the newly created entry" — implying the new
  entry actually persists). See Code Review Change Request 1 for the exact mechanism and repro
  conditions; no test in `AgentMemoryRepositorySpec` or `AgentMemoryRoutesSpec` exercises the
  triggering precondition, so `sbt test` passes despite the defect.
- All other acceptance criteria pass:
  - `agent_memory` table created via Flyway (V82) with owner-only RLS (`ENABLE`+`FORCE`, policy
    on `owner_id`) and both required indexes (`idx_agent_memory_owner_id`,
    `idx_agent_memory_owner_created`) — verified by reading the migration and by
    `RlsOwnerTablesSpec`'s new `agent_memory` section (though see Code Review Change Request 2 for
    a separate, mechanical gap in a *different* guard spec).
  - `list`/`delete`/`clear`/`touch` behave per spec and are RLS-isolated
    (`RlsOwnerTablesSpec` + `AgentMemoryRepositorySpec` cross-user no-op cases).
  - REST endpoints (`GET/POST /api/agent/memory`, `DELETE /api/agent/memory/:id`,
    `DELETE /api/agent/memory`) all implemented, routed, and covered by
    `AgentMemoryRoutesSpec` + `ApiRoutesSpec`'s 401 coverage; `schemas/agent-memory.schema.json`
    added and confirmed in sync via `node scripts/check-schema-drift.mjs`.
  - `sbt test`: 2910/2910 passing (fresh run, see Phase 2). No inline FQNs
    (`node scripts/check-scala-quality.mjs`: clean).
- All 16 `tasks.md` items are marked `[x]` and match what was implemented — no partial or
  reinterpreted task items found.
- No scope creep: `git diff main...HEAD --stat` matches `files-modified.md`'s file list exactly;
  no changes outside the ticket's declared scope.
- No regressions found: full `sbt test` suite (2910 tests, unrelated to this ticket included)
  passes clean.
- Planning artifacts mostly reflect implemented behavior, with one exception: `design.md`
  Decision 3's own described algorithm (`ORDER BY last_used_at ASC NULLS FIRST, created_at ASC
  LIMIT 1` over the owner's full row set, run *after* the insert) is what was implemented
  faithfully — but that algorithm itself does not structurally guarantee the "delete an
  **existing** entry" invariant `specs/agent-memory-persistence/spec.md` states as ground truth.
  This is a design/spec inconsistency that surfaced as a real implementation bug (Change Request
  1) rather than a mismatch between design.md and the code.

### Phase 2: Code Review — FAIL

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` requested this cycle — `default` speed,
`EVALUATOR_CLEAN_WORKTREE=false` per `workflow-state.md`). Changed files are backend-only
(`git diff --name-only main...HEAD | grep '^frontend/'` → empty), so only the backend gate
applies:

- `cd backend && sbt test` → **2910/2910 tests passed**, 189 suites, 0 failed, 0 canceled. Full
  output captured; migrations V1–V82 applied cleanly including the new V82.
- `node scripts/check-scala-quality.mjs` → clean (no new inline-FQN violations; the two new spec
  files are under the 250-line soft budget; only pre-existing, unrelated soft-budget warnings on
  files this ticket didn't touch).
- `node scripts/check-schema-drift.mjs` → "schemas in sync with JsonProtocols (57 checked across
  45 protocol files)" — `agent-memory.schema.json` resolves correctly against
  `AgentMemoryEntryResponse`.

Issues:

1. **[Correctness/mechanical] `AgentMemoryRepository.add`'s cap-and-evict can delete the entry it
   just inserted, not an existing one** —
   `backend/src/main/scala/com/helio/infrastructure/AgentMemoryRepository.scala:30-34` (`add`)
   and `:75-89` (`evictIfOverCap`). `evictIfOverCap` selects the eviction candidate via
   `table.filter(_.ownerId === ownerUuid).sortBy(m => (m.lastUsedAt.asc.nullsFirst,
   m.createdAt.asc)).map(_.id).take(1)` over **all** of the owner's rows, including the row that
   was inserted earlier in the same `andThen` chain (`add`, line 32:
   `(table += toRow(entry)) andThen evictIfOverCap(ownerUuid, cap)`). `AgentMemoryService.add`
   (`backend/src/main/scala/com/helio/services/AgentMemoryService.scala:31-38`) always
   constructs new entries with `lastUsedAt = None`. If every one of the owner's other
   (pre-existing, at-cap) rows already has a non-null `lastUsedAt` (i.e. has been `touch`ed at
   least once — a realistic state once 420-C starts touching entries it reads), the newly-inserted
   row is the *sole* `NULLS FIRST` candidate and is deleted in the same transaction. The caller's
   `add` still returns `Right(entry)` / HTTP 201 for an entry that no longer exists in the table.
   This violates `specs/agent-memory-persistence/spec.md`'s requirement text ("delete exactly one
   **existing** entry for that owner") and `specs/agent-memory-api/spec.md`'s
   "Creating past the per-user cap evicts the least-recently-useful entry" scenario. None of the
   current tests exercise the "all pre-existing rows already touched, new row untouched"
   precondition — `AgentMemoryRepositorySpec`'s eviction test seeds 101 entries that all share
   `lastUsedAt = None`, so `created_at` alone breaks every tie and the always-newest new row is
   never selected. **Fix**: exclude the just-inserted row's id from the eviction candidate query
   (e.g. `table.filter(m => m.ownerId === ownerUuid && m.id =!= newRowId)` before the
   `sortBy`/`take(1)`), or compute the eviction target from the pre-insert row set. Add a
   regression test: seed the cap with entries that all have a non-null `lastUsedAt` (i.e.
   `touch`ed), then `add` one more and assert the new entry survives in `list()` while an existing
   entry was evicted.

2. **[Mechanical, CONTRIBUTING.md] `agent_memory` is missing from `RlsPolicyGuardSpec`'s
   `rlsTables` allowlist** —
   `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala:53-84`. CONTRIBUTING.md's
   "Adding a new ACL'd table" checklist (under "Database transactions & RLS context") requires, in
   the same PR as the migration: "Add the table name to the `rlsTables` allowlist in
   `RlsPolicyGuardSpec` — the guard spec will fail CI if this step is missed." The `rlsTables` `Set`
   at line 53 lists every other owner-scoped table through `V81`'s `agent_preferences` but does not
   include `"agent_memory"`. `RlsOwnerTablesSpec`'s new `agent_memory` section proves cross-user
   isolation *behaviorally* (a good, complementary test), but it does not substitute for
   `RlsPolicyGuardSpec`'s mechanical `pg_class.relrowsecurity` / `relforcerowsecurity` /
   `pg_policies` assertions, which currently never run against `agent_memory` at all — the exact
   gap this guard spec exists to catch. **Fix**: add `"agent_memory"` to the `rlsTables` `Set`
   (with a `// V82 — agent_memory, direct owner (HEL-478 / 420-B)` comment matching the existing
   convention for each entry).

No other issues found:

- DRY: repository/service/routes/protocol all closely mirror `ApiTokenRepository` /
  `AgentPreferencesService` / `ApiTokenRoutes` conventions; no unnecessary duplication.
- Readable/modular: small, single-purpose files; naming is clear; no magic values (the `100` cap
  lives in one named constant, `AgentMemoryService.MaxEntriesPerUser`).
- Type safety: value-class IDs at the route boundary via `AgentMemoryIdSegment`
  (`IdParsing.scala`), no untyped escape hatches.
- Security: `ownerId`/`id`/`createdAt`/`lastUsedAt` are always server-set, never taken from the
  wire request; all repository access goes through `DbContext.withUserContext`; no raw SQL string
  interpolation of user input.
- Error handling: `AgentMemoryService` maps invalid `kind`/blank `content` to
  `ServiceError.BadRequest`; `delete` maps not-found/cross-user to `ServiceError.NotFound`; no
  silent failures.
- Dead code: none found; no leftover TODO/FIXME.
- Over-engineering: none — the cap constant is a single `private val`, matching design.md's
  stated intent for 420-E to widen later without restructuring.
- Design.md (frontend design-language standard): N/A — no `frontend/**` changes.

### Phase 3: UI Review — N/A

This ticket is backend-only. `git diff --name-only main...HEAD | grep '^frontend/'` is empty, and
`grep -rn "agent/memory\|AgentMemory" frontend/src` returns zero hits — no frontend code
references or consumes the new `/api/agent/memory` endpoints. Although `ApiRoutes.scala` and
`schemas/agent-memory.schema.json` technically match the Phase-3 trigger list, there is no UI
surface in this ticket's scope to exercise: `GET/POST/DELETE /api/agent/memory` is store-only
infrastructure; the management UI is the downstream 420-D (HEL-525) ticket. No dev-server startup
or browser session was needed for this cycle.

### Overall: FAIL

### Change Requests

1. Fix `AgentMemoryRepository.add`'s cap-and-evict so it can never delete the row it just
   inserted — exclude the newly-inserted row's id from the eviction candidate query in
   `evictIfOverCap` (`backend/src/main/scala/com/helio/infrastructure/AgentMemoryRepository.scala:75-89`,
   called from `add` at line 32), or otherwise restructure so the eviction target is always drawn
   from the owner's pre-insert row set. Add a regression test seeding the cap with all-touched
   entries (`lastUsedAt` non-null) then `add`ing one more untouched entry, asserting the new entry
   survives in `list()` and an existing entry was evicted instead.
2. Add `"agent_memory"` to the `rlsTables` `Set` in
   `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala:53-84`, per
   CONTRIBUTING.md's "Adding a new ACL'd table" checklist (step 3), so the mechanical
   RLS/FORCE-RLS/policy-existence guard actually covers the new table.

### Non-blocking Suggestions

- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala:31` — the new
  `AgentMemoryIdSegment` declaration's column alignment doesn't match the rest of the block's
  manually-aligned `=` columns (cosmetic only; no scalafmt gate enforces this in this repo).
