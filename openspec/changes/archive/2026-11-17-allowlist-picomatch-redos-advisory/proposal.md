## Why

Main's `security` CI job is red on GHSA-fc5q-39xc-vjpf (picomatch `<= 4.0.7` ReDoS). No patched picomatch exists
(4.0.7 is latest), every finding is on a dev/build-tool path (`npm audit --omit=dev` is 0 in both trees), and
`ci-complete` requires `security`, so every open PR is blocked. The owner ruled: allowlist, dev-only, HEL-1246 pattern.

## What Changes

- Root `.audit-ci.jsonc` and `frontend/.audit-ci.jsonc` gain path-scoped allowlist entries
  (`"GHSA-fc5q-39xc-vjpf|<scope>*"`) covering exactly the dev-tool parent paths audit-ci reports, each with an inline
  comment: HEL-1751, dev-only / no patch, dependency paths, review-by 2026-12-17.
- The HEL-1246 braces entry (review-by 2026-11-02, past) is re-checked and either removed (advisory no longer reported
  or patched) or its review-by date extended, with the reason in its comment.
- A recorded check proves the scopes are tight: the same advisory via a non-allowlisted path still fails audit-ci.

## Capabilities

### New Capabilities

### Modified Capabilities
- `root-dependency-audit`: picomatch advisory allowlisted on dev-tool paths only.
- `frontend-dependency-audit`: picomatch advisory allowlisted on dev-tool paths only; the audit scenario now allows
  allowlisted high findings (mirrors root wording).

## Impact

Config only: two `.audit-ci.jsonc` files plus spec deltas. No package.json, lockfile, override or pin changes.
helio-mcp/ is clean and untouched.

## Non-goals

- Upgrading jest/vite/typescript-eslint or overriding picomatch (no patched release exists).
- Changing the CI workflow or audit threshold.
