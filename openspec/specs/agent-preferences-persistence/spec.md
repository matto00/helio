# agent-preferences-persistence Specification

## Purpose
Owner-isolated, Flyway-backed persistence (`agent_preferences` table + `AgentPreferencesRepository`)
for the agent's per-user authoring defaults — series colors, panel style, naming conventions, and
a JSONB `extras` escape hatch — the structured half of Agent Memory & Preferences (HEL-420).
## Requirements
### Requirement: agent_preferences table with owner-only RLS
The database SHALL have an `agent_preferences` table with columns `user_id UUID PRIMARY KEY`,
`preferences JSONB NOT NULL DEFAULT '{}'`, and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
protected by owner-only row-level security (`ENABLE`+`FORCE`, policy on `user_id`) following the
`V42`/`V54` pattern.

#### Scenario: Migration creates agent_preferences table
- **WHEN** Flyway migration V81 runs
- **THEN** the `agent_preferences` table exists with the columns above
- **AND** row-level security is enabled and forced on the table

#### Scenario: Owner can read and write only their own row
- **WHEN** a request runs under `withUserContext(ownerA)`
- **THEN** it can read and upsert only the row where `user_id = ownerA`

#### Scenario: Owner cannot read another user's row
- **WHEN** ownerA's context queries `agent_preferences` and ownerB has a stored row
- **THEN** ownerA's query does not return ownerB's row

#### Scenario: Owner cannot overwrite another user's row
- **WHEN** ownerA's context attempts to upsert a row with `user_id = ownerB`
- **THEN** the write is rejected or has no effect on ownerB's row (RLS-enforced)

#### Scenario: Privileged context sees all rows
- **WHEN** a query runs under `withSystemContext` (BYPASSRLS)
- **THEN** it can see `agent_preferences` rows for every user

### Requirement: AgentPreferencesRepository upserts by user
The system SHALL have an `AgentPreferencesRepository` that exposes:
- `get(userId): Future[Option[AgentPreferences]]` — returns `None` when no row exists for the user.
- `put(userId, prefs): Future[AgentPreferences]` — inserts a new row or fully replaces the
  existing row for that user (`INSERT ... ON CONFLICT (user_id) DO UPDATE`), returning the
  persisted value.

#### Scenario: get returns None when no row exists
- **WHEN** `get(userId)` is called for a user with no stored preferences
- **THEN** it returns `None`

#### Scenario: put inserts a new row
- **WHEN** `put(userId, prefs)` is called for a user with no existing row
- **THEN** a new `agent_preferences` row is inserted for that user

#### Scenario: put replaces an existing row
- **WHEN** `put(userId, prefs)` is called for a user who already has a stored row
- **THEN** the existing row's `preferences` and `updated_at` are fully replaced with the new
  values (not merged field-by-field)

#### Scenario: Round-trip preserves all fields
- **WHEN** `put(userId, prefs)` is called with `defaultSeriesColors`, `defaultPanelStyle`,
  `namingConventions`, and `extras` all populated
- **THEN** a subsequent `get(userId)` returns exactly those values unchanged

