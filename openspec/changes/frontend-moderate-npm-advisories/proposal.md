## Why

`npm audit` in `frontend/` reports 20 moderate findings that CI never fails on, because `frontend/.audit-ci.jsonc` gates
only at `high`. All 20 are one advisory, GHSA-hp3w-g68c-fv3c (sprintf-js, no patched version), reached through a
single dev-only chain that an existing override pins to js-yaml 3. helio-mcp already gates at moderate (HEL-1204).

## What Changes

- Retarget the existing `frontend/package.json` override `@istanbuljs/load-nyc-config > js-yaml` from `^3.15.2` to
  `^4.1.1` (owner ruling Q1, 2026-10-07). This drops argparse@1, sprintf-js and esprima from the frontend lockfile;
  `npm audit` goes to 0.
- Lower `frontend/.audit-ci.jsonc` from `"high": true` to `"moderate": true` (owner ruling Q2), allowlist stays empty.
- Update the CI `security` job comment, `docs/dependency-management.md`, `MISTAKES.md` and the
  `helio-mcp/.audit-ci.jsonc` header comment to state the new frontend/
  threshold.
- Record the per-advisory triage table (package, parent, runtime vs dev, fix available) and the full lockfile delta
  in the PR body and design.md.

## Capabilities

### New Capabilities
- `frontend-dependency-audit`: CI gates the `frontend/` lockfile at moderate severity, with justified, path-scoped
  allowlist entries only for advisories that have no usable patch.

### Modified Capabilities
None.

## Non-goals

- The root lockfile's threshold (stays `high`, its HEL-1246 braces entry untouched).
- Any jest / ts-jest / babel-jest version change, direct or major.
- Enforcing allowlist expiry for audit-ci (gap already documented; not this ticket).

## Impact

`frontend/package.json` (overrides), `frontend/package-lock.json` (4 entries), `frontend/.audit-ci.jsonc`,
`.github/workflows/ci.yml` (comment only), `docs/dependency-management.md`,
`MISTAKES.md`, `helio-mcp/.audit-ci.jsonc` (comment only). Dev/build-only: no runtime bundle change.
