# HEL-1462: check-precommit-ci-parity.mjs takes the first `needs:` match (a comment can satisfy it); a frontend job dropped from ci-complete.needs is caught only by the pre-commit hook

## Description

Origin: HEL-1428 (ci-complete.needs guard rebuilt on js-yaml 4.3.2), lane-reported; the design gate reproduced item 1.

1. `scripts/check-precommit-ci-parity.mjs` `parseCiCompleteNeeds` takes the FIRST `needs:` regex match, so a comment or string containing `needs: [...]` can stand in for the real list and the check passes wrongly. Rebuild it on the same js-yaml parsing HEL-1428 introduced (fail-closed on the parsed document). Red-first with the adversarial fixture.
2. The CI run of the new `check-ci-complete-needs` guard lives inside the `frontend` job, so if `frontend` itself is removed from `ci-complete.needs`, only the local pre-commit hook catches it. Consider running the guard in `ci-complete` itself (or a tiny always-run job that ci-complete needs), and show a red.

Priority: Low. Labels: Bug, Follow-up. Related: HEL-1428.

## Acceptance Criteria

- AC1: `check-precommit-ci-parity.mjs` reads `ci-complete.needs` and each job's `run:` steps from a js-yaml parse of ci.yml (no regex over raw YAML for structure), failing closed when ci.yml does not parse or `ci-complete`/its `needs` cannot be established. A comment or string containing `needs: [...]` can no longer stand in for the real list.
- AC2: Red-first: an adversarial selftest fixture (comment decoy listing the full needs above a real list that drops the hook-covering job) fails the OLD implementation and passes (is detected) with the new one.
- AC3: `check:ci-complete-needs` runs inside the `ci-complete` job itself, so dropping `frontend` (or any job) from `ci-complete.needs` turns the required check red in CI, not only in the pre-commit hook. A red is shown for that mutation.
- AC4: The hook still passes on a clean tree and fails on each mutation; gate-chain isolation evidence for every touched hook-invoked script.
