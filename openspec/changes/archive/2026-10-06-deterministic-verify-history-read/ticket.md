# HEL-1297: helio-mcp verify harness: make the 30-point history read deterministic (shared-DB retention purge)

## Description

origin_kind: followup
origin_ticket: HEL-1274

HEL-1274's verify harness proves `get_output_history` with 30 real pipeline runs and then reads all 30 points back.
All worktree backends share one dev DB, and since HEL-1272 every backend runs the hourly retention purge. A purge from
another backend can thin the fixture's points mid-verify. The harness fails loudly when this happens, so it can't pass
falsely, but it can fail intermittently.

## Acceptance Criteria

- Make the read deterministic. Options: run verify against a dedicated database, or set `OUTPUT_HISTORY_*` so the
  fixture's points are exempt or the interval can't elapse. Note that the lane's own backend already used
  `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES=1440`, but other backends sharing the DB don't.
- Document the setup in the helio-mcp README.

## Driver requirements (binding for this run)

- Explain why the chosen option holds when OTHER backends purge (and re-check HEL-1343's
  `OUTPUT_HISTORY_LOCK_RETRY_SECONDS` interaction).
- Prove it: show the old setup can be thinned mid-verify by a purge from a second backend (red), and that the new
  setup cannot (green).
- Build helio-mcp fresh in the worktree; never use the session's MCP tools.
- Do not add dependencies to helio-mcp (HEL-1204 moderate audit gate).
- Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`, `frontend/package-lock.json`.
- Never pick deletion targets (rows, users, databases, processes) by pattern, name prefix or time window; no
  `pkill`/`pgrep`/`killall`. Record exact ids/PIDs/database names and remove by those. Never touch `matt@helio.dev`.
  Revoke any PAT minted.
- Backend tests, if any: `nice -n 19 sbt testFull`, at most 2 workers.
