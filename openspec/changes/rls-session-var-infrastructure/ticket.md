# HEL-273: RLS session-var infrastructure (HikariCP + Slick wrapper)

## Scope

Foundational infrastructure for HEL-272 (RLS epic). Must ship before any policies are enabled.

Build the plumbing that propagates the authenticated user's ID into the Postgres session at the start of every transaction, so RLS policies can reference `current_setting('app.current_user_id')`.

## Why this is the riskiest sub-ticket

HikariCP pools connections. A connection returned to the pool with stale session state, then handed to a request for a different user, would silently bypass the RLS policy. **This is a P0 data-leak incident class.** Getting this right is non-negotiable.

## Design constraints

* Use `SET LOCAL app.current_user_id = ?` (transaction-scoped, auto-cleared at COMMIT/ROLLBACK)
* All DBIO actions that read or write ACL'd tables must run inside an explicit transaction with the session var set as the first statement
* A code path that forgets to set the session var must fail closed (policy denies all rows) rather than silently leak
* The wrapper must work with Slick's `DBIO.seq`, `for`-comprehensions, and `transactionally`

## Tasks

- [ ] Decide on the abstraction: a `withUserContext(user)(action)` helper that wraps a DBIO with a `SET LOCAL` prefix and runs it `.transactionally`
- [ ] Decide on the privileged variant: `withSystemContext(action)` (paired with HEL-XXX privileged-bypass sub-ticket)
- [ ] Implement the wrapper in `backend/src/main/scala/com/helio/infrastructure/`
- [ ] Migrate every repository read/write to go through the wrapper
- [ ] Connection-leak regression test: open a connection, set the user context, run a query, return it to the pool, open another connection from the pool, query without setting context — must fail closed (no rows, not "rows from user A")
- [ ] Document the wrapper pattern in `CONTRIBUTING.md` so future contributors know to use it

## Verification

* All existing tests still pass (with policies OFF — that comes in later sub-tickets)
* The connection-leak regression test passes
* No raw `db.run(action)` calls remain in repositories — all go through the wrapper or its `*Internal` sibling

## Acceptance criteria

1. Every ACL'd repository read/write goes through `withUserContext` (or documented `withSystemContext`)
2. Connection-leak regression test in place and passing
3. CONTRIBUTING.md pattern documented
4. Pre-commit / scala-quality enforces: no raw `db.run` on ACL'd tables outside the wrapper

## Out of scope

* Enabling any RLS policy (later sub-tickets)
* Privileged role / `BYPASSRLS` design (separate sub-ticket — they're parallelizable but this one ships first)

## Additional delivery context

- AuthService is OFF-LIMITS — do not modify it
- Respect Pekko/actor boundaries: no blocking operations on actor execution paths; keep DB work on the appropriate execution context
- `SET LOCAL` (not `SET`) scopes the session var to the transaction — this is the correct approach for HikariCP connection pools
- This is security-sensitive infrastructure — correctness and connection-pool safety are paramount
- Priority: High
- Parent epic: HEL-272 (RLS Epic)
- Unblocks: HEL-274, HEL-275, HEL-276, HEL-277
