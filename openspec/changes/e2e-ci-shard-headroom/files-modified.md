- `.github/actions/e2e-setup/action.yml` — NEW composite action: the shared e2e setup steps (D4), HEL-1288/HEL-1299 comments kept beside their steps
- `.github/workflows/ci.yml` — `e2e` uses the action, matrix [1..6], max-parallel 6; `e2e-prod-build` uses it with start-dev-frontend "false"; comments per D1/D6; selftest step wired into `frontend`
- `.github/workflows/e2e-slow.yml` — uses the action; `pull_request.paths` adds the action; header sentence replaced
- `scripts/e2e-shard.mjs` — DEFAULT_E2E_LEGS = 6 shared by `plan` and `weights`; `weights --legs <n>` (parseWeightsArgs)
- `scripts/e2e-shard.selftest.mjs` — 6-report default, `--legs 4`, 5-of-6 refused, default == ci.yml matrix and max-parallel
- `scripts/check-e2e-slow-results.selftest.mjs` — NEW failable selftest for the slow-lane results guard (D5)
- `scripts/check-ci-sbt-no-pattern-kill.mjs` — SCANNED adds e2e-slow.yml and the action (D4a)
- `package.json` — npm script `check:e2e-slow-results:selftest`
- `playwright.config.ts` — comment only: leg count text
- `e2e/README.md` — leg-count and `weights --legs` regeneration text
- `openspec/changes/e2e-ci-shard-headroom/tasks.md` — tasks ticked (3.4a left for Delivery)
- `openspec/changes/e2e-ci-shard-headroom/files-modified.md` — this file

- `openspec/changes/e2e-ci-shard-headroom/.openspec.yaml`, `proposal.md`, `design.md`, `ticket.md`, `skeptic-design-1.md`, `skeptic-design-2.md`, `specs/e2e-ci-sharding/spec.md` — NEW change artifacts (planning, unchanged by the executor)

## Evidence

- Full local e2e (task 3.4): `DEV_PORT=7130 BACKEND_PORT=10037 HELIO_PLAYWRIGHT_WORKERS=2 nice -n 19 flock -w 3600 <scratchpad>/e2e.lock npx playwright test --workers=2` against this worktree's servers: 661 passed, 3 skipped, 0 failed, 0 flaky, 42.1m, exit 0.
- Mutation M1: ci.yml matrix edited to 5 legs -> `check:e2e-shard:selftest` exit 1 (AssertionError expected 6); restored (cmp identical), 17 cases pass.
- Mutation M2: in a scratch copy, `stats.skipped > 0` check disabled in check-e2e-slow-results.mjs -> its selftest exit 1 (skipped-test case fails); real files pass (6 cases).
- Mutation M3 (D4a, in-memory only, never executed): `checkText` on action.yml text plus an appended pattern-kill line reported `.github/actions/e2e-setup/action.yml:75: pattern-matching process lookup/kill`; real file returns []; `check:ci-sbt-guard` ok (6 files scanned), its selftest passes.
- Also green: check:ci-complete-needs, check:precommit-ci-parity, check:e2e-prod-build-projects (+selftest), lint, format:check; `plan 6` runs. actionlint not installed.

## Cycle 2 (skeptic-final-1.md)

- `.github/dependabot.yml` — github-actions entry now `directories: ["/", "/.github/actions/*"]` so the composite action's pins are bumped
- `.github/actions/e2e-setup/action.yml` — header comment notes Dependabot coverage
- `e2e/README.md` — `plan 4` -> `plan` (default 6 legs)
- `playwright.config.ts` — comment only: parenthesis and line length fixed
- `scripts/e2e-shard.selftest.mjs` — CLI case: `weights --legs 4 <dir>` exits 0, same dir without `--legs` fails naming it. Mutation (scratch copy, `legs` dropped in `findReports`): selftest exit 1; real file 18 cases pass
- `check:dependabot` and its selftest pass unchanged (the checker parses real YAML and only matches npm entries; no checker change needed)

## Explicit path list (CON-260, every path in the branch diff)
- `.github/actions/e2e-setup/action.yml`
- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/e2e-slow.yml`
- `e2e/README.md`
- `package.json`
- `playwright.config.ts`
- `scripts/check-ci-sbt-no-pattern-kill.mjs`
- `scripts/check-e2e-slow-results.selftest.mjs`
- `scripts/e2e-shard.mjs`
- `scripts/e2e-shard.selftest.mjs`
- `openspec/changes/e2e-ci-shard-headroom/.openspec.yaml`
- `openspec/changes/e2e-ci-shard-headroom/design.md`
- `openspec/changes/e2e-ci-shard-headroom/evaluation-1.md`
- `openspec/changes/e2e-ci-shard-headroom/files-modified.md`
- `openspec/changes/e2e-ci-shard-headroom/proposal.md`
- `openspec/changes/e2e-ci-shard-headroom/skeptic-design-1.md`
- `openspec/changes/e2e-ci-shard-headroom/skeptic-design-2.md`
- `openspec/changes/e2e-ci-shard-headroom/skeptic-final-1.md`
- `openspec/changes/e2e-ci-shard-headroom/skeptic-final-2.md`
- `openspec/changes/e2e-ci-shard-headroom/specs/e2e-ci-sharding/spec.md`
- `openspec/changes/e2e-ci-shard-headroom/tasks.md`
- `openspec/changes/e2e-ci-shard-headroom/ticket.md`
No file was moved or deleted.
