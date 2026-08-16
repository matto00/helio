## Evaluation Report — Cycle 2 (evaluation-2.md)

### Resumed review

Resumed from cycle 1 (`evaluation-1.md`, Overall: FAIL). Re-read only what changed:
`git diff 429c85b8..33006d39` (executor's cycle-2 commit on top of cycle 1's `429c85b8`) and the
orchestrator's cycle-2 handoff message. Ticket/proposal/design/tasks/spec deltas were not
re-read (stable since cycle 1).

### Phase 1: Spec Review — PASS

Issues: none.

- Both cycle-1 change requests are addressed, and the fixes match what the diff actually does
  (not just what the executor's handoff claims):
  - **CR1 (cap-and-evict self-eviction)**: `AgentMemoryRepository.add`
    (`backend/src/main/scala/com/helio/infrastructure/AgentMemoryRepository.scala:30-34`) now
    threads the newly-inserted row's `UUID` (`newRowId`) into `evictIfOverCap`, which filters it
    out of the eviction candidate query (`m.id =!= excludeId`, line ~84) before the
    `sortBy(lastUsedAt.asc.nullsFirst, createdAt.asc).take(1)` selection. This structurally
    guarantees the eviction target is always drawn from the owner's *pre-existing* rows, matching
    `specs/agent-memory-persistence/spec.md`'s "delete exactly one existing entry" requirement.
  - **CR2 (RlsPolicyGuardSpec allowlist gap)**: `"agent_memory"` was added to the `rlsTables` `Set`
    in `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala:86-87`, with a
    `// V82 — agent_memory, direct owner (HEL-478 / 420-B)` comment matching the established
    per-entry convention.
- `openspec/changes/agent-memory-store/files-modified.md` and `workflow-state.md` were updated to
  document the cycle-2 changes and cycle-1 verdict — accurate and consistent with the actual diff.
- No scope creep: the diff (`git diff 429c85b8..33006d39 --stat`) touches only the repository fix,
  its regression test, the guard-spec allowlist entry, and handoff docs — nothing outside the two
  change requests.
- No regressions: full `sbt test` (see Phase 2) is green, including all pre-existing
  `AgentMemoryRepositorySpec`/`RlsOwnerTablesSpec`/`AgentMemoryRoutesSpec`/`ApiRoutesSpec` cases
  from cycle 1.

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH` (still backend-only:
`git diff --name-only main...HEAD | grep '^frontend/'` → empty; no `CLEAN_WORKTREE` requested this
cycle):

- `cd backend && sbt test` → **2914/2914 passed**, 189 suites, 0 failed, 0 canceled (up from
  2910 in cycle 1 — the expected +4: 1 new `AgentMemoryRepositorySpec` regression test + 3 new
  generated `RlsPolicyGuardSpec` cases for `agent_memory`, from its `for (tableName <-
  rlsTables...)` loop).
- Independently re-ran the two touched suites in isolation to verify ground truth rather than the
  aggregate count alone:
  - `sbt "testOnly com.helio.infrastructure.AgentMemoryRepositorySpec"` → 11/11 passed, including
    `AgentMemoryRepository.add - should evict an existing entry, never the newly-inserted one,
    when every pre-existing entry has already been touched (non-null last_used_at)` — the exact
    regression test requested in cycle 1's Change Request 1, confirmed passing against the fixed
    code.
  - `sbt "testOnly com.helio.infrastructure.AgentMemoryRepositorySpec com.helio.infrastructure.RlsPolicyGuardSpec"`
    → 77/77 passed, including the three newly-generated `agent_memory has relrowsecurity = true`
    / `relforcerowsecurity = true` / `has at least one policy` cases — confirming CR2's fix is
    real and the guard spec now actually exercises V82's table.
- `node scripts/check-scala-quality.mjs` → clean (106 pre-existing, unrelated soft-budget
  warnings only; the touched files
  (`AgentMemoryRepository.scala` 148 lines, `AgentMemoryRepositorySpec.scala` 236 lines,
  `RlsPolicyGuardSpec.scala` 209 lines) remain under the 250-line soft budget; no inline FQNs).
- `node scripts/check-schema-drift.mjs` → "schemas in sync" (unaffected by this cycle's changes).
- `node scripts/check-openspec-hygiene.mjs` → same single note as cycle 1 ("change
  'agent-memory-store' is complete (16/16) but not archived") — a structural, expected note (the
  change hasn't been archived yet, which is a later delivery-phase step, not a code defect); not a
  regression, matches the accepted HEL-472 precedent noted by the executor.

Fix quality: the exclusion is scoped correctly (filters the eviction *candidate* query only, not
`list`/`delete`/`clear`, which don't need it) and the added doc comment on `evictIfOverCap`
explains the invariant clearly for future readers. No new issues introduced by the fix itself —
DRY/readable/modular/type-safe/secure/error-handling all still hold per cycle 1's otherwise-clean
findings.

### Phase 3: UI Review — N/A

Unchanged from cycle 1: this ticket is backend-only. No `frontend/**` files in the diff; no
frontend code references `/api/agent/memory`. No UI surface to review.

### Overall: PASS

### Change Requests

None — both cycle-1 change requests were fixed and independently verified against fresh
evidence.

### Non-blocking Suggestions

- (carried over from cycle 1, still applicable, not blocking) `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala:31`
  — the `AgentMemoryIdSegment` declaration's column alignment doesn't match the rest of the
  block's manually-aligned `=` columns (cosmetic only; no scalafmt gate enforces this in this
  repo).
