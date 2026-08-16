## Context

HEL-478 (420-B) is the free-form-memory half of the Agent Memory & Preferences epic (HEL-420),
sibling to the structured `AgentPreferences` store (420-A, HEL-472, merged). Downstream tickets
depend on this shape: 420-C (HEL-521) feeds it into agent-authoring context, 420-D (HEL-525)
builds a management UI, 420-E (HEL-531) adds privacy/retention controls — this ticket's
per-user cap is the retention-bound prerequisite HEL-438 (Data Retention & Privacy) coordinates
on.

Existing owner-scoped resources to mirror: `ApiToken`/`ApiTokenRepository`/`ApiTokenService`/
`ApiTokenRoutes` (`create`/`list`/`revoke` CRUD shape, closest structural analogue — multiple
entries per owner, create/list/delete, not a single per-user row like 420-A's `AgentPreferences`)
and the owner-only RLS migrations `V42__api_tokens.sql`/`V54__image_uploads.sql`/
`V81__agent_preferences.sql`. `ScheduleKind` (`model.scala`) is the precedent for a closed
string-allow-list enum (`fromString`/`asString`, `Left`/`Right` validation). Checked for a
naming collision the way 420-A required (`grep` for `AgentMemory`/`agent_memory`/
`api/agent/memory` across `backend/src/main/scala`, `schemas/`, `openspec/specs/`) — none found,
so no escalation needed here.

## Goals / Non-Goals

**Goals:**
- Durable, owner-isolated, free-form memory entries with a closed `kind` allow-list.
- A hard per-user cap (100 entries) enforced transactionally at write time — never an unbounded
  table — with deterministic, testable eviction (oldest-`lastUsedAt`-then-`createdAt`).
- Full CRUD surface (`add`/`list`/`touch`/`delete`/`clear`) proven RLS-isolated between users.

**Non-Goals:**
- Feeding memory into the agent's authoring context (420-C / HEL-521).
- A management UI (420-D / HEL-525) or the privacy opt-out toggle / retention *policy*
  (420-E / HEL-531) — this ticket only provides the mechanical cap-and-evict bound HEL-438
  coordinates on, not a user-facing retention policy.
- Automatic memory extraction from conversations (HEL-341/HEL-343 concern) — this ticket is the
  store + explicit write API only; nothing in this change infers memory from conversation text.
- Any interaction with 420-A's `AgentPreferences` — separate table, separate concern.

## Decisions

**Decision 1 — table shape: one row per memory entry, not a JSONB blob (unlike 420-A).**
`agent_memory (id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES users(id) ON DELETE
CASCADE, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT
now(), last_used_at TIMESTAMPTZ)`. Unlike 420-A's single-row-per-user JSONB store, this is a
multi-row-per-owner table (many memory entries per user) — structurally identical to
`api_tokens`, not `agent_preferences`. `kind` is `TEXT`, not a DB-level enum/check constraint;
the closed allow-list (`fact`/`goal`/`preference-note`) is enforced at the domain boundary via
`AgentMemoryKind.fromString`, exactly like `ScheduleKind` — consistent with this codebase's
existing precedent of keeping enum validation in Scala, not Postgres.

**Decision 2 — RLS: owner-only, `ENABLE`+`FORCE`, single policy on `owner_id` (V42/V54/V81
pattern).**
```sql
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_memory_owner ON agent_memory
  USING (owner_id = current_setting('app.current_user_id')::uuid);
```
No separate `WITH CHECK` — as in every prior owner-scoped table, the `USING` expression alone
also gates `INSERT`. Two indexes: `idx_agent_memory_owner_id` (the RLS predicate column, per the
established "covers the owner-only policy predicate" convention) and
`idx_agent_memory_owner_created` (composite `(owner_id, created_at)`) to support the eviction
query's ordering without a full-table sort per insert.

**Decision 3 — cap-and-evict is one atomic DB transaction, not read-then-delete-then-insert
from Scala.** `AgentMemoryRepository.add` runs, under `withUserContext(ownerId)`, as a single
Slick `DBIO.seq`/transactionally-composed action: (a) insert the new row, (b) count the owner's
rows, (c) if count > 100, delete the 1 row with the oldest `last_used_at` (nulls-first, i.e. a
never-touched entry is evicted before a recently-touched one) then oldest `created_at` as the
tiebreak, via `ORDER BY last_used_at ASC NULLS FIRST, created_at ASC LIMIT 1`. Doing this as one
transaction (not separate Scala-orchestrated calls) substantially narrows the race where two
concurrent `add` calls for the same user could both pass a "count <= 100" check and jointly
exceed the cap (see the Risks section for the residual, accepted edge case this doesn't fully
close). Alternative considered: application-level check-then-evict-then-insert (two round
trips) — rejected as strictly worse on this same race.
`list(user)` returns entries newest-first (`ORDER BY created_at DESC`), matching
`ApiTokenRepository.list`'s explicit ordering convention.

**Decision 4 — `touch(id)` updates `last_used_at`, is a no-op (not an error) for an unknown or
cross-user id.** Mirrors `ApiTokenRepository.touchLastUsed`'s update-based (not
read-then-write) shape; `touch` returning silently for a not-found id (rather than 404) matches
its expected caller (420-C's context-assembly path marking entries as "used" opportunistically,
non-critical if the id has already been evicted between read and touch).

**Decision 5 — `delete`/`clear` return counts, not booleans, but the routes still 204/404
appropriately.** `delete(id, user): Future[Boolean]` (found-and-deleted vs. not-found-or-not-
owned, indistinguishable at the API — same precedent as `ApiTokenRepository.revoke`) drives a
204/404 route response. `clear(user): Future[Int]` (rows deleted) always 204 regardless of
count, since "clear an already-empty memory" is not an error condition.

**Decision 6 — RLS isolation test: extend `RlsOwnerTablesSpec`, not a new spec file** (same
precedent as 420-A's Decision 5) — add an `agent_memory` section seeding via the real
repository's `add`, proving `withUserContext(ownerA)` cannot see/evict/clear `ownerB`'s entries
and `withSystemContext` sees both. A **separate**, dedicated `AgentMemoryRepositorySpec` test
(not RLS) proves the cap-and-evict mechanics themselves (insert 101 entries, assert the
least-recently-useful is gone and the count stays at 100) — that's eviction-correctness, not
RLS, and deserves its own focused suite per CONTRIBUTING.md's "tests meaningful" bar.

## Risks / Trade-offs

- [Risk] A fixed cap of 100 is a guess, not derived from a product decision. → Mitigation: the
  ticket explicitly says "e.g. 100 entries" (a placeholder default, not a hard product
  requirement); making it a `private val` constant on `AgentMemoryService` (not hardcoded inline
  in the repository query) keeps it a one-line change for 420-E's eventual retention-policy
  ticket to make configurable, without altering the eviction mechanism itself.
- [Risk] `ORDER BY last_used_at ASC NULLS FIRST, created_at ASC LIMIT 1` inside the same
  transaction as the insert could contend under concurrent writes for the same user (unlikely in
  practice — one interactive user, not a high-throughput multi-writer scenario). → Mitigation:
  acceptable for this ticket's scope (a single user's own memory writes are inherently
  sequential from that user's own session); not optimizing for concurrent-writer throughput here.
