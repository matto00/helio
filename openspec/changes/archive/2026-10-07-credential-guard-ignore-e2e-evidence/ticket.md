# HEL-1369: Credential-surface pre-commit guard fails COVERAGE DRIFT on gitignored e2e-evidence/

## Description

HEL-1363 (54c2f222e) added the gitignored top-level `e2e-evidence/` folder, which `e2e/support/evidencePath.ts`
writes to. It did not add the folder to `IGNORED_TOP_LEVEL` in `scripts/check-no-credential-in-agent-surface.mjs`.
Once any e2e spec that saves screenshots has run in a worktree, the pre-commit hook fails with "COVERAGE DRIFT".

The executor, evaluator and skeptic all reproduced this during HEL-1331. Lanes are currently getting past it by
moving the folder out of the worktree before committing, which is friction for every e2e lane.

Priority: High. Related: HEL-1363, HEL-1331.

## Acceptance Criteria

- Add `e2e-evidence` to `IGNORED_TOP_LEVEL`, in line with the script's own comment at line ~145.
- Add a selftest or red run showing that the guard fails before the fix when `e2e-evidence/` is present, and passes
  after.
- Grep for any other gitignored top-level folder HEL-1363 or later work created that has the same gap.
