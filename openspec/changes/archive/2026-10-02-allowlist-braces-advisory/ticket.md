# HEL-1246: Allowlist unfixable dev-only braces advisory GHSA-vfj7-8cjw-p6xm in .audit-ci.jsonc (blocks every PR's security check)

## Description

CI's `security` job (`npx audit-ci --config .audit-ci.jsonc`) fails on GHSA-vfj7-8cjw-p6xm (braces stack-exhaustion DoS, high). Path: `jest > @jest/core > micromatch@4.0.8 > braces@3.0.3`. `first_patched_version` is null; braces 3.0.3 is the latest release; micromatch 4.0.8 (latest) depends on `braces ^3.0.3`, so no bump/override can clear it. `npm ls braces --omit=dev` is empty (dev-only). This sends `ci-complete` red on every PR (first seen on PR #734, HEL-1244).

Owner ruling 2026-10-03: allowlist it with a review date, through its own lane.

## Acceptance Criteria

- Add `GHSA-vfj7-8cjw-p6xm` to the ROOT `.audit-ci.jsonc` allowlist with an inline comment: this ticket; "dev-only (jest->micromatch->braces), no patched version"; review-by date 2026-11-02; remove once a patched braces/micromatch ships.
- Narrowest allowlist form audit-ci supports (specific GHSA id, ideally path-scoped). No severity downgrade, no blanket suppression.
- Check whether frontend/.audit-ci.jsonc and the helio-mcp audit need the same entry, against what CI actually runs.
- CI `security` is green on this PR.
- A deliberately-added different high advisory still fails the check (not a blanket). Show it (never committed).
- After merge, PR #734 re-runs green.
