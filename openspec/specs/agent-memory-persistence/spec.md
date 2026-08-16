# agent-memory-persistence Specification

## Purpose
Owner-isolated, Flyway-backed persistence (`agent_memory` table + `AgentMemoryRepository`) for
the agent's free-form per-user memory entries (facts, goals, preference notes), bounded by a
deterministic per-user cap with oldest-`last_used_at`-then-`created_at` eviction so it can grow
across sessions without becoming unbounded.
## Requirements
### Requirement: agent_memory table with owner-only RLS and eviction indexes
The database SHALL have an `agent_memory` table with columns `id UUID PRIMARY KEY`,
`owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `kind TEXT NOT NULL`,
`content TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, and
`last_used_at TIMESTAMPTZ`, protected by owner-only row-level security (`ENABLE`+`FORCE`,
policy on `owner_id`), with an index on `owner_id` and a composite index on
`(owner_id, created_at)` to support eviction ordering.

#### Scenario: Migration creates agent_memory table
- **WHEN** Flyway migration V82 runs
- **THEN** the `agent_memory` table exists with the columns above
- **AND** row-level security is enabled and forced on the table
- **AND** an index on `owner_id` and a composite index on `(owner_id, created_at)` exist

#### Scenario: Owner cannot read another user's entries
- **WHEN** ownerA's context queries `agent_memory` and ownerB has stored entries
- **THEN** ownerA's query does not return any of ownerB's entries

#### Scenario: Owner cannot delete or clear another user's entries
- **WHEN** ownerA's context attempts to delete or clear entries owned by ownerB
- **THEN** the write affects zero of ownerB's rows (RLS-enforced)

#### Scenario: Privileged context sees all entries
- **WHEN** a query runs under `withSystemContext` (BYPASSRLS)
- **THEN** it can see `agent_memory` entries for every user

### Requirement: AgentMemoryRepository enforces a per-user cap with deterministic eviction
The system SHALL have an `AgentMemoryRepository` whose `add` operation enforces a fixed
per-user cap (100 entries): inserting an entry that would put the owner's total above the cap
SHALL, in the same transaction as the insert, delete exactly one existing entry for that
owner — the one with the oldest `last_used_at` (an entry with no `last_used_at` is evicted
before any entry that has one), using `created_at` as the tiebreak when `last_used_at` is equal
or both absent.

#### Scenario: add under the cap does not evict
- **WHEN** `add` is called for a user with fewer than 100 existing entries
- **THEN** the new entry is inserted and no existing entry is deleted

#### Scenario: add past the cap evicts the least-recently-useful entry
- **WHEN** `add` is called for a user who already has 100 entries
- **THEN** the new entry is inserted
- **AND** exactly one existing entry is deleted — the one with the oldest `last_used_at`
  (nulls evicted first), falling back to oldest `created_at` as the tiebreak
- **AND** the user's total entry count remains 100

#### Scenario: touch updates last_used_at and affects eviction order
- **WHEN** `touch(id)` is called for an existing entry
- **THEN** that entry's `last_used_at` is updated to the current time
- **AND** a subsequent eviction (triggered by exceeding the cap) does not select that entry
  while other, less-recently-touched entries remain

#### Scenario: touch on an unknown or cross-user id is a no-op
- **WHEN** `touch(id)` is called with an id that does not exist, or belongs to another user
- **THEN** no row is modified and no error is raised

### Requirement: AgentMemoryRepository list/delete/clear are RLS-scoped
The system SHALL have an `AgentMemoryRepository` exposing `list(user): Future[Seq[AgentMemoryEntry]]`
(all of the caller's entries), `delete(id, user): Future[Boolean]` (true if an entry owned by
the caller was deleted), and `clear(user): Future[Int]` (count of entries deleted), each scoped
to the caller via `withUserContext`.

#### Scenario: list returns only the caller's entries, newest first
- **WHEN** `list(user)` is called
- **THEN** it returns only entries where `owner_id` matches the caller
- **AND** entries are ordered newest-first by `created_at`

#### Scenario: delete removes only a caller-owned entry
- **WHEN** `delete(id, user)` is called for an entry owned by the caller
- **THEN** the entry is removed and the call returns `true`

#### Scenario: delete on an unknown or cross-user id returns false
- **WHEN** `delete(id, user)` is called with an id that does not exist, or belongs to another
  user
- **THEN** no row is removed and the call returns `false`

#### Scenario: clear removes all of the caller's entries
- **WHEN** `clear(user)` is called for a user with N stored entries
- **THEN** all N entries owned by the caller are removed
- **AND** the call returns `N`

