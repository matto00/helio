## Why

The verify harness's 30-point `get_output_history` read (HEL-1274) fails intermittently: every worktree backend shares
one dev DB and runs the retention thin/purge (HEL-1272). The thin DELETE partitions over *every* Output using the
*purging* backend's own policy (5-minute recent buckets by default), so another backend's pass collapses the fixture's
30 points to ~1 per 5 minutes. No `OUTPUT_HISTORY_*` value on the verify lane's own backend can stop a different
backend's pass, and HEL-1343's lock-busy retry makes contending backends purge *more* often, not less.

## What Changes

- Add an isolated verify mode (`npm run verify:isolated`, a script under `helio-mcp/scripts/`) that creates a
  dedicated, uniquely named Postgres database, boots a backend against it (purge interval 1440 minutes), registers a
  throwaway user and bootstrap PAT on that database, runs the existing harness, then stops that backend by its exact
  PID and drops that database by its exact name — pass or fail.
- Point the harness's thinning failure message at the isolated mode.
- Document the setup, and why it holds when other backends purge, in the helio-mcp README.
- No backend code changes; no new dependencies.

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-verify-harness`: adds a requirement that the 30-point history read has an isolated run mode no other backend's
  retention purge can reach.

## Impact

- `helio-mcp/scripts/` (new isolated-run script; verify.ts message), `helio-mcp/package.json` (script entry only),
  `helio-mcp/README.md`.
- Local Postgres: one transient database per isolated run, dropped by exact name at exit.

## Non-goals

- Changing retention behaviour or the purge lock (backend untouched).
- Running verify in CI.
- Making plain `npm run verify` against the shared DB deterministic (it stays a smoke run; its failure points to the
  isolated mode).
