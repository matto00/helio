## Why

Two CI-topology guards overlap and both have a hole (HEL-1462, follow-up of HEL-1428). `check-precommit-ci-parity.mjs`
finds `ci-complete`'s `needs` with a first-match regex, so a comment such as `# needs: [frontend, ...]` above the real
list satisfies it: reproduced on a temp copy of ci.yml where the real `needs` drops `frontend` -- the parity check prints
OK while all 28 hook scripts become unreachable from the merge gate. Separately, the HEL-1428 guard
`check-ci-complete-needs` runs in CI only inside the `frontend` job; drop `frontend` from `ci-complete.needs` and the job
that would catch it is no longer awaited, so `ci-complete` (which is `if: always()`) goes green. Only the bypassable
pre-commit hook catches it.

## What Changes

- Rebuild `check-precommit-ci-parity.mjs`'s CI-side parsing on js-yaml: the `needs` list comes from the parsed document
  (reusing HEL-1428's fail-closed `checkCiCompleteNeeds` contract rather than a second parser), and each scanned job's
  commands come from its parsed `steps[].run` strings. Regex stays only for extracting `npm run`/`node <path>` tokens
  from a `run:` string and hook lines (unchanged semantics). Unparseable YAML / missing `ci-complete` / non-list `needs`
  is an error, not a silent empty set.
- The set of merge-gating jobs the parity check scans becomes `ci-complete.needs` plus `ci-complete` itself.
- Run `npm run check:ci-complete-needs` inside the `ci-complete` job (checkout, setup-node, root `npm ci`), as a
  step of the always-run `ci-complete` job (no step-level `if:`), and make `check-ci-complete-needs` fail if `ci-complete`'s own steps stop invoking it (self-anchoring,
  so moving it back out of the gate job is itself caught by the hook).
- Selftests: adversarial red-first fixtures for both defects.

## Capabilities

### New Capabilities
- `precommit-ci-parity-guard`: the hook-vs-CI parity check's contract -- which CI jobs count as merge-gating and how
  ci.yml is read (parsed YAML, fail-closed).

### Modified Capabilities
- `ci-required-jobs-guard`: the guard runs inside `ci-complete` itself (not in a job `ci-complete` depends on) and
  fails when `ci-complete` no longer runs it.

## Impact

`scripts/check-precommit-ci-parity.mjs` (+selftest), `scripts/check-ci-complete-needs.mjs` (+selftest; hook-invoked:
gate-chain change), `.github/workflows/ci.yml` (`ci-complete` gains checkout/setup-node/npm ci/guard steps and a longer
timeout). No product code, no `.husky/pre-commit` change, no new dependency (js-yaml 4.3.2 is already a root devDependency).
