## Why

`follow-redirects` versions <= 1.15.11 leak custom authentication headers to cross-domain redirect targets (Dependabot alert #37). Patching to >= 1.16.0 closes the vulnerability and keeps the frontend dependency tree auditable.

## What Changes

- Add an `overrides` entry in `frontend/package.json` pinning `follow-redirects` to `>=1.16.0`
- Regenerate `frontend/package-lock.json` via `npm install`

## Capabilities

### New Capabilities

<!-- None — this is a dependency patch with no behavioral surface changes -->

### Modified Capabilities

<!-- None — no spec-level requirement changes -->

## Impact

- `frontend/package.json` — new `overrides` block
- `frontend/package-lock.json` — updated transitive resolution for `follow-redirects`
- No API, schema, or runtime behavior changes

## Non-goals

- Upgrading axios or webpack-dev-server beyond what is required to resolve the vulnerability
- Any frontend feature work
