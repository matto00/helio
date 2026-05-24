# HEL-274 — RLS privileged-bypass design (separate role or whitelist flag)

## Scope

Design and ship the privileged-bypass mechanism for HEL-272. Required before
policies are enabled, otherwise our background/system paths break.

## Why we need this

Several callsites in Helio legitimately need to read across users without a
user context — these are documented in HEL-265 CS2/CS3 as `*Internal` methods:

- `ResourceTypeRegistry` resolvers (resolve a resource's `ownerId` to perform
  the ACL check itself — chicken-and-egg)
- `PipelineRunService.upsertFieldsFromRows` (privileged DataType field schema
  upsert during pipeline execution)
- `JoinStep` evaluation (legitimately reads `rightDataSourceId` which may not
  belong to the pipeline owner — flagged spinoff)
- `SparkJobSubmitter` (Spark batch driver runs without user context)
- Boot-time `SourceSchemaHealthCheck` and similar background paths

With RLS enabled, these paths must explicitly opt into bypass, and the bypass
must be auditable.

## Design options

### Option A — Separate `BYPASSRLS` role

- Create a `helio_privileged` Postgres role with `BYPASSRLS`
- Maintain TWO HikariCP pools: app (`helio_app`, non-bypassing) and privileged
  (`helio_privileged`)
- `withSystemContext` runs against the privileged pool
- Pro: bulletproof — privileged path uses physically different connections
- Con: connection pool tuning x2; complicates Flyway (uses which role?)

### Option B — Whitelist flag in session

- Single role, single pool
- `withSystemContext` sets `SET LOCAL app.is_system = true` and every policy
  clauses `current_setting('app.current_user_id') = owner_id OR
  current_setting('app.is_system', true) = 'true'`
- Pro: simpler infra
- Con: every policy gets the OR clause; a forgotten `SET LOCAL` in user-context
  paths could be silently exploited

### Recommendation (to validate during this ticket)

Option A. The cost of a forgotten policy clause is too high; physical
separation via a `BYPASSRLS` role makes the privileged path explicit and
unforgettable.

## Tasks

- [ ] Settle on Option A vs B (write design doc)
- [ ] If A: Flyway-managed role creation + grant; second HikariCP config;
      second `db` handle in DI
- [ ] If A: `withSystemContext` runs against the privileged pool
- [ ] If B: policy template includes the `OR is_system` clause; helper to
      construct it
- [ ] Audit every `*Internal` callsite from HEL-265 CS2/CS3 and confirm it
      routes through `withSystemContext`
- [ ] Add inline comments at every `withSystemContext` callsite explaining why
      ACL bypass is correct
- [ ] Regression test: `withSystemContext` can read across users; `withUserContext`
      cannot

## Acceptance criteria

1. Decision documented (Option A or B with rationale)
2. Privileged bypass mechanism implemented end-to-end
3. Every existing `*Internal` callsite migrated to the new mechanism with
   inline justification comment
4. Regression test passes

## Blocks

HEL-275 (enable RLS on owner-only tables) and HEL-276 (enable RLS on
sharing-aware tables).

## Out of scope

- Enabling any RLS policy on actual tables (later sub-tickets)
- Session-var infrastructure (separate parallel sub-ticket — already landed as
  HEL-273)

## Context: HEL-273 infrastructure already in place

`DbContext` (from HEL-273) provides:
- `withUserContext(userId)(action)` — sets `app.current_user_id` = userId for
  the transaction duration via `SET LOCAL`
- `withSystemContext(action)` — sets `app.current_user_id` = `'system'`
  sentinel for the transaction duration

The `'system'` sentinel is the switching point. This ticket decides what that
sentinel means at the Postgres level and ensures the privileged pool (Option A)
or session flag (Option B) is wired up correctly.

## Guardrails

- AuthService is OFF-LIMITS
- Respect Pekko actor boundaries (no blocking on actor exec paths)
- Prove the bypass can't be triggered by a normal user-context request
