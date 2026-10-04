## Why

`helio-mcp/package-lock.json` carries 9 moderate runtime advisories (hono x4, ip-address x4, fast-uri x1 — live
`npm audit`, 2026-10-04) that CI never sees: the `security` job's `audit-ci` steps cover only the root and `frontend/`
lockfiles. They surface only as Dependabot banners after a release push (HEL-1204, follow-up of HEL-1202).

## What Changes

- Regenerate `helio-mcp/package-lock.json` so every advisory resolves to a real patched version (lockfile-only;
  `package.json` untouched unless a justified change is required).
- Add `helio-mcp/.audit-ci.jsonc` gating at **moderate** (not high — see design.md D2) with an allowlist that is empty
  unless an advisory has no patch, in which case the HEL-1246 path-scoped, ticketed, review-by-dated pattern is used.
- Add a `helio-mcp` audit step to `.github/workflows/ci.yml`'s `security` job, using the root-pinned `audit-ci`.
- Update `MISTAKES.md`'s "security gate" entry to name all three audited trees and helio-mcp's moderate threshold.
- Record red-first and red-gate (reintroduce-vulnerable, revert) evidence transcripts in the change directory.

## Capabilities

### New Capabilities
- `helio-mcp-dependency-audit`: CI audits helio-mcp's lockfile and the lockfile is kept free of known advisories.

### Modified Capabilities

## Non-goals

- Changing the root or `frontend/` audit thresholds or allowlists.
- Rebuilding the gitignored `helio-mcp/dist` used by the live session MCP server.
- Any helio-mcp source, backend, or frontend change.
- Dependabot configuration changes.

## Impact

`helio-mcp/package-lock.json`, `helio-mcp/.audit-ci.jsonc` (new), `.github/workflows/ci.yml` (security job),
`MISTAKES.md`. No migration, no API change. Runtime-affecting: hono / @hono/node-server / ip-address / fast-uri
patch/minor bumps inside `@modelcontextprotocol/sdk`'s tree.
