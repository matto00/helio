## Why

Backend specs intermittently abort in CI because an embedded Postgres instance that loses its port to a concurrent instance silently adopts that other instance's cluster. The adopting spec then runs against a foreign database. HEL-1445 (`role ... already exists`) and HEL-1470 (`This connection has been closed`) are two symptoms of this one defect, both confirmed from their CI logs (see `ticket.md`). Renaming roles or adding `IF NOT EXISTS` would only hide it: the spec would keep running on a foreign cluster that can shut down under it.

## What Changes

- Add one shared test-support helper that starts embedded Postgres and verifies the cluster it connected to is its own, by comparing the server's `data_directory` with the instance's own data directory. On a mismatch it discards the attempt without touching the foreign cluster and retries on a fresh port, a bounded number of times, then fails loudly.
- Mechanically migrate all 226 `EmbeddedPostgres.builder()...start()` call sites (221 test files) onto the helper. The builder configuration chain is preserved verbatim. Make the change with a script, and verify it with a script.
- Add a guard spec that fails on any direct embedded-Postgres start outside the helper and names the offending file.
- Add a deterministic port-steal regression spec, showing that the direct path attaches to a foreign cluster and the helper does not.
- No change to any role, grant, `SET ROLE`, RLS property, schema or production code. Existing `IF NOT EXISTS` role DO-blocks stay as they are.

## Capabilities

### New Capabilities
- `backend-embedded-postgres-isolation`: backend tests that use embedded Postgres always run against the cluster they started themselves, never one adopted after a port collision. A guard rejects any start that bypasses this.

### Modified Capabilities
<!-- none -->

## Impact

- Test code only: `backend/src/test/**`. 221 spec/fixture files get a mechanical one-expression change. There is one new helper, one guard spec and one regression spec.
- No production code, schema, migration, dependency, CI workflow or build change.
- Fixes HEL-1470 as well (the same root cause).
- Overlaps with the concurrent lane HEL-1435, which may edit output-history harnesses. Whichever lane merges second reconciles, and the guard makes any missed site fail loudly.
