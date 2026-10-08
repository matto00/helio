## Why

The root lockfile still resolves GHSA-hp3w-g68c-fv3c (sprintf-js, moderate, no patched version) through the root
`package.json` override `@istanbuljs/load-nyc-config > js-yaml ^3.15.2`, the same dev-only chain HEL-1320 removed from
`frontend/`. CI never sees it because the root `.audit-ci.jsonc` gates only at `high`. frontend/ (HEL-1320) and
helio-mcp/ (HEL-1204) already gate at moderate.

## What Changes

- Retarget the root `package.json` override `@istanbuljs/load-nyc-config > js-yaml` from `^3.15.2` to `^4.1.1`
  (same value as frontend/, HEL-1320) and regenerate `package-lock.json`. Expected lockfile delta: js-yaml 3.15.2
  (nested), argparse 1.0.10 (nested), esprima 4.0.1 and sprintf-js 1.0.3 removed; nothing else.
- Lower the root `.audit-ci.jsonc` from `"high": true` to `"moderate": true` (owner ruling 2026-10-08). The existing
  HEL-1246 braces allowlist entry is kept unchanged; no new allowlist entry.
- Update every place that states the root threshold as `high`: `.github/workflows/ci.yml` security-job comment,
  `docs/dependency-management.md`, `MISTAKES.md` security-gate entry, `helio-mcp/.audit-ci.jsonc` header comment.

## Capabilities

### New Capabilities
- `root-dependency-audit`: CI gates the root npm lockfile at moderate severity, with path-scoped, justified
  allowlist entries only for advisories with no usable patch.

### Modified Capabilities
None.

## Non-goals

- Any jest / ts-jest / babel-jest version change, direct or major.
- Removing or changing the HEL-1246 braces allowlist entry (its review-by date stands).
- frontend/ or helio-mcp/ lockfiles or configs (beyond the helio-mcp comment wording).
- Enforcing allowlist expiry for audit-ci.

## Impact

`package.json` (overrides), `package-lock.json` (4 removed entries), `.audit-ci.jsonc`, `.github/workflows/ci.yml`
(comment only), `docs/dependency-management.md`, `MISTAKES.md`, `helio-mcp/.audit-ci.jsonc` (comment only).
Dev-only tree: no runtime bundle change.
