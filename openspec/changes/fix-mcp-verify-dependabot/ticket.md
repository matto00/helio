# HEL-1264: helio-mcp `npm run verify` smoke script sends the pre-HEL-913 create_pipeline shape; add helio-mcp to Dependabot

## Description

origin_kind: followup — origin_ticket: HEL-1204. Found by the HEL-1204 lane; its evaluator and final skeptic each
confirmed from source that this predates HEL-1204.

**1. Broken smoke script.** `npm run verify` against a running backend passes every read tool, then fails at
`create_pipeline` with `roots: Required`. Cause: `helio-mcp/scripts/verify.ts` (last changed in HEL-907) still sends
the old single-`source` shape; HEL-913 replaced it with a `roots[]` schema.

**2. No Dependabot entry for helio-mcp.** `.github/dependabot.yml` has no entry for `helio-mcp/`, so helio-mcp gets
security alerts but no automatic update PRs. Per the owner, this is folded into this ticket.

## Acceptance Criteria

- `verify.ts` uses the current request shapes for every write tool it calls, not just `create_pipeline`. Re-check
  all of them against the current schemas.
- `npm run verify` passes end to end against a backend running from the worktree.
- verify creates its own fixtures and cleans them up by exact id, including any PAT it mints, which it revokes.
- If it's cheap, add a guard so the script cannot silently drift from the schemas again (e.g. validating its
  payloads against `schemas/`).
- `.github/dependabot.yml` gains an npm entry for `/helio-mcp`, matching the cadence and grouping conventions of the
  existing entries.

## Driver constraints (this run)

- Proof: `npm run verify` red at the old shape and green end-to-end against a backend running from THIS worktree
  (backend process cwd checked via `readlink /proc/<pid>/cwd`). Any schema-drift guard shown red under a mutation.
- No backend change, no migration. A backend bug revealed by verify is escalated, not fixed.
- Do not touch the main checkout's gitignored `helio-mcp/dist` (live session MCP); build in the worktree only.
- Do not touch HEL-1233 (dashboard layout repair) or HEL-1147 (pipeline step preview validation) areas.
- Shared dev DB: residue deleted by exact id only. Scratch files removed by exact path. Never write under `~`
  outside the repo; no global installs. Heavy commands at `nice -n 19`.
