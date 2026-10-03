## Why

The root `npm audit` (via audit-ci) fails on GHSA-vfj7-8cjw-p6xm, a high braces advisory with no patched version anywhere in the micromatch/braces chain, turning `ci-complete` red on every PR. The package is dev-only (jest), so the owner ruled to allowlist it with a dated review.

## What Changes

- Add one allowlist entry for GHSA-vfj7-8cjw-p6xm to the root `.audit-ci.jsonc`, with an inline comment (ticket, dev-only rationale, review-by 2026-11-02, remove-once-patched), and update the file's now-stale "Empty today" header sentence.
- No change to `frontend/.audit-ci.jsonc` or helio-mcp (CI audits only root and frontend/, and frontend/ is already clean).

## Capabilities

### New Capabilities

### Modified Capabilities

## Impact

`.audit-ci.jsonc` only. No runtime, dependency, backend or frontend source change.
