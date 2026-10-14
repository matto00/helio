## Why

When zonky 2.0.7's `Builder.start()` throws after it has already launched `pg_ctl -w start` (for example its readiness
wait gives up), the caller never receives the instance, so `VerifiedEmbeddedPostgres` cannot `close()` it — and it then
deletes the attempt's data directory from under the still-running postmaster. The postmaster keeps its port and runs
on a deleted directory (HEL-1586, found in HEL-1474).

## What Changes

- On a throwing library start, the shared embedded-Postgres helper detects whether a postmaster was launched on the
  attempt's own data directory and, if so, stops it with `pg_ctl -D <that dir> stop -m immediate` before deleting the
  directory. It never addresses a port, a process name, or a PID found by search.
- If that stop cannot be confirmed, the helper leaves the directory in place (rather than deleting it from under a
  live postmaster) and attaches the reason to the propagated error; the library's original error still propagates.
- A deterministic regression test injects a fault right after a real postmaster launch and proves the fix stops it
  and leaves no process alive; a second test drives zonky's own post-launch throw.

## Capabilities

### New Capabilities

### Modified Capabilities
- `backend-embedded-postgres-isolation`: "The library's own start fails" now also covers a failure after the
  postmaster launch — the attempt's own postmaster is stopped (by its own data directory only) before cleanup.

## Impact

- `backend/src/test/scala/com/helio/testkit/VerifiedEmbeddedPostgres.scala` and its spec. Test infrastructure only;
  no production code, API, schema or migration change.

## Non-goals

- Closing zonky's leaked lock-file stream or removing its registered shutdown hook (unreachable without the instance;
  released at JVM exit).
- Upgrading or patching zonky.
