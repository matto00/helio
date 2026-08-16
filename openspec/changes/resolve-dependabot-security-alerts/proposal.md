# Proposal: resolve-dependabot-security-alerts

## Why

35 Dependabot security alerts (15 high, 19 medium, 1 low) are open across the repo's three npm lockfiles, several
exploitable in runtime-critical frontend packages (axios, react-router). They have sat unaddressed for an extended
period; the longest-standing high-severity advisories date back months.

## What Changes

- Bump every flagged package to at least its advisory's first-patched version, across `frontend/package-lock.json`,
  `helio-mcp/package-lock.json`, and the root `package-lock.json`.
- Direct-dependency bumps (both minor, no major jump): `axios` `^1.15.0` → `>= 1.18.0`; `react-router-dom` `^7.16.0`
  → `>= 7.18.2` (clears the `react-router` alerts).
- Transitive-dependency refreshes (lockfile-only where the parent's semver range allows; `overrides` only where a
  parent pins below the patched version): `postcss >= 8.5.23`, `fast-uri >= 3.1.5`, `brace-expansion >= 1.1.16 / 2.1.2`,
  `js-yaml >= 3.15.1 / 4.3.1`, `sharp >= 0.35.0` (frontend); `hono >= 4.12.34`, `ip-address >= 10.3.1`,
  `fast-uri >= 3.1.5`, `@hono/node-server >= 1.19.15` (helio-mcp); `js-yaml >= 3.15.1 / 4.3.1` (root).
- Runtime verification of axios HTTP calls and react-router navigation in the live app (not just unit tests).
- Supersede Dependabot PR #258 (axios 1.16.0 → 1.18.0): sufficient for the 10 axios alerts but only 10 of 35 —
  closed as superseded once this change merges.

## Capabilities

### New Capabilities

None — this is a dependency-security maintenance change with no behavioral or contract changes.

### Modified Capabilities

None — no spec-level behavior changes; archive with `--skip-specs`.

## Impact

- Three `package-lock.json` files (+ `frontend/package.json` for the two direct-dep range bumps; `overrides` blocks
  only if required).
- No backend/Scala, no Flyway migrations, no API contract changes.
- Risk surface: axios and react-router are runtime-critical to `frontend/` — both bumps stay within their current
  major, and affected code paths are exercised live before delivery.

## Non-goals

- Alerts opened after this ticket was scoped (future Dependabot findings are follow-ups).
- Upgrading any package beyond what its advisories require (no opportunistic major bumps).
- Backend or infra dependency changes.
