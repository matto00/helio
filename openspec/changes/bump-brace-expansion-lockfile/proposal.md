## Why

`npm audit` at the repo root reports the `brace-expansion` regex-DoS advisory
pair GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895. This is a transitive
dependency, not application code, so there is no spec-level behavior change —
just a security patch that needs to land before it accumulates with other
open findings.

## What Changes

- Bump the affected `brace-expansion` instance(s) in the root
  `package-lock.json` to the first version that patches both GHSAs, via a
  targeted `npm update` / scoped `overrides` entry (same pattern as HEL-688) —
  no `npm audit fix --force`, no blanket dependency updates.
- Check `frontend/package-lock.json` and `helio-mcp/package-lock.json` for the
  same vulnerable `brace-expansion` range; bump those too if Dependabot has
  since raised alerts against them.
- Re-run `npm audit` at the root to confirm the advisory pair no longer
  appears.

## Capabilities

### New Capabilities

None — this is a transitive-dependency security bump with no application
capability change.

### Modified Capabilities

None — no spec-level requirement changes. No API/behavior surface changes.

## Impact

- `package-lock.json` (root), and possibly `frontend/package-lock.json` /
  `helio-mcp/package-lock.json` if they're independently affected.
- No source code changes. `npm test` and lint must stay green in every
  touched workspace.

## Non-goals

- No `npm audit fix --force` or blanket `npm update` across all dependencies.
- No unrelated dependency bumps beyond `brace-expansion` and whatever
  transitively requires the bump.
