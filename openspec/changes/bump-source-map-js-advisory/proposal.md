## Why

The CI `security` job is red on every PR and on main, blocking every lane's merge. Two newly published advisories
("nothing moved, the world did") fail two of its `audit-ci` steps independently:

- **GHSA-68fv-2mgg-jv7q** (high) — `source-map-js` 1.2.1 in `frontend/package-lock.json` (event-loop DoS via
  indexed source-map section offsets). Patched in 1.2.2. Fails the `Frontend audit (frontend/)` step.
- **GHSA-jqcg-44mw-7w3h** (critical) — `proxy-addr` 2.0.7 in `helio-mcp/package-lock.json` (IP spoofing via an
  IPv4-mapped IPv6 trust subnet). Patched in 2.0.8. Fails the `helio-mcp audit (helio-mcp/)` step. Folded in by
  owner decision (2026-10-06): fixing only the first would leave the job red.

## What Changes

- `frontend/package-lock.json`: `source-map-js` 1.2.1 → 1.2.2 (in range of its sole parent `postcss@8.5.26`,
  which declares `^1.2.1`), via a targeted lockfile-only update. No `overrides` entry, no `package.json` change.
- `helio-mcp/package-lock.json`: `proxy-addr` 2.0.7 → 2.0.8 (in range of its sole parent `express@5.2.1`,
  which declares `^2.0.7`), same approach.
- `frontend/.audit-ci.jsonc` and `helio-mcp/.audit-ci.jsonc`: replace the stale "npm audit is 0" comment lines
  with an accurate description of current state. Thresholds and allowlists are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — dependency patch only, no spec-level behavior change (`skip_specs: true`).

## Impact

- Two lockfiles and two audit-config comments. No source files, no `package.json`, no CI workflow change.
- Runtime: `source-map-js` is build-time (postcss under vite). `proxy-addr` is in helio-mcp's lockfile (and so in
  its audit gate) only transitively via `@modelcontextprotocol/sdk` → `express`; helio-mcp uses
  `StdioServerTransport` only and never imports the SDK's express helper, so it is not on helio-mcp's code path.
  Both are patch-level bumps.

## Non-goals

- The 20 moderate advisories in the `frontend/` tree (below the `"high"` threshold) — tracked as HEL-1320.
- Any change to audit thresholds, allowlists, `.github/workflows/ci.yml`, or `playwright.config.ts`.
- Any other dependency version movement (no `npm update` without a package argument, no `npm audit fix`).
