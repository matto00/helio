## Why

The CI `security` job is red on main and every open PR. Three handlebars advisories published 2026-10-08
(GHSA-p8wg-vrv2-v86f critical, GHSA-8r5x-fm3f-whwj critical, GHSA-xw65-4hp5-5hc7 moderate; affected
`>=4.0.0 <=4.7.9`) fail two `audit-ci` steps: `Frontend audit (root)` and `Frontend audit (frontend/)`.
`helio-mcp audit` passes (no handlebars in that tree). The ticket's braces item is already covered by the
HEL-1246 allowlist on its only path and is not reported by CI.

## What Changes

- `package-lock.json` (root): `handlebars` 4.7.9 -> 4.7.10, in range of its sole parent `ts-jest@29.4.6`
  (`^4.7.8`). Targeted lockfile-only update; no `overrides` entry, no `package.json` change (HEL-1319 precedent:
  an in-range patch needs no override).
- `frontend/package-lock.json`: `handlebars` 4.7.9 -> 4.7.10, in range of `ts-jest@29.4.9` (`^4.7.9`). Same approach.
- `helio-mcp/`: no change (clean; the CI step passed).
- `.audit-ci.jsonc` files: no change (thresholds, allowlists and comments remain accurate).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — dependency patch only, no spec-level behavior change (`skip_specs: true`).

## Impact

- Two lockfiles only. handlebars is dev-only (ts-jest's dependency, used for its config-set templating); not in
  any shipped bundle. Patch-level bump; 4.7.10's dependency set is identical except `minimist ^1.2.8` (was
  `^1.2.5`), which must already be satisfied by the locked minimist — verified: minimist is locked at 1.2.8 in both trees.

## Non-goals

- braces GHSA-vfj7-8cjw-p6xm (no patched version; already allowlisted on its only path by HEL-1246).
- Any change to audit thresholds, allowlists, `.github/workflows/ci.yml`, `package.json`, or source.
- Any other dependency movement (no bare `npm update`, no `npm audit fix`).
