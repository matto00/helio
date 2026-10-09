## Standing Constraints

- [C1] No sbt-cache experiment writes, prunes or relocates anything under `~`; the D2 prune proof is the PR's own CI run (prune after restore, before `compile; testFull`).
- [C2] Record the measured pruned compile size, per-leg "Compile and test" times vs the base main run, and the prune step time from PR CI; projection > 5 GB, failing legs, a full recompile, or any leg > 10% and > 30 s slower returns to the design gate with numbers.

## 1. ### CI — sbt dependency cache (D1)

- [x] 1.1 Replace every "Cache sbt" `actions/cache` (backend, security, e2e) with `actions/cache/restore`, same paths/key/restore-keys; verify `grep -c 'uses: actions/cache@' .github/workflows/*.yml` is 0
- [x] 1.2 Add one main-only `actions/cache/save` (backend shard 0, after compile/test, gated push+main+no exact hit); verify by `actionlint` (or `npx yaml` parse) and by reading the `if:`
- [x] 1.3 Add a report-only PR step printing `du -sh` per restored sbt path; record the composition in design notes; trim a path only with proof it is unused

## 2. ### CI — compile cache bound (D2)

- [x] 2.1 Write `scripts/ci-prune-sbt-cas.sh` (`report`/`prune`; selective `ac` keep, never `proc`/coursier/ivy); verify with its selftest (5.2) on a fixture tree under the worktree, never `~`
- [x] 2.2 Wire `prune` after restore/before `compile; testFull` on PR runs, and after compile/test before save on main shard 0; verify by reading the `if:`s
- [x] 2.3 On the PR's CI: all backend legs green; record S, prune time, per-leg compile/test times vs base main run, recomputed projection in design.md (C2)

## 3. ### CD — no tag-scoped caches (D3)

- [x] 3.1 Remove `cache: npm` from `cd-frontend.yml` setup-node; record last 3 tag runs' `npm ci` durations as baseline; verify no `cache:` remains in `cd-*.yml`

## 4. ### CI — janitor and PR-close cleanup (D4, D5)

- [x] 4.1 Write `scripts/cache-janitor.mjs` (allowlist families incl. `sbt-<64hex>` KEEP=1, main-only, keep newest 2 otherwise, delete by id, log key/ref/size, `--dry-run`); verify `--dry-run` against the live listing prints the expected set and deletes nothing
- [x] 4.2 Add `.github/workflows/cache-janitor.yml` (workflow_run CI `branches: [main]`, 6-hourly schedule, dispatch with dry_run, concurrency group, default-branch checkout; `actions: write` only); verify by reading + YAML parse
- [x] 4.3 Add `.github/workflows/cache-cleanup-pr.yml` (`pull_request_target` closed, no checkout, exact `refs/pull/<N>/merge` delete via env-passed integer); verify with the static check in 5.3

## 5. ### Tests

- [x] 5.1 `scripts/cache-janitor.selftest.mjs` over a fixture listing asserts the exact deletion set (non-allowlisted, PR, tag entries survive); wire into CI frontend job + npm script; show it red against a mutated selector
- [x] 5.2 Selftest (or scripted check) for the prune script on a fixture CAS: referenced blobs kept, unreferenced removed, `ac` entries naming a pruned blob dropped and others kept, `proc` untouched, report-only mode deletes nothing
- [x] 5.3 Static selftest of `cache-cleanup-pr.yml`: exact ref line, PR number only via env from `github.event.pull_request.number`, no checkout, no other delete (`GH_TOKEN` env allowed); shown red on a mutated copy
- [x] 5.4 Run the full pre-commit gate chain and relevant `check:*` scripts green (incl. precommit-ci-parity if it covers new selftests)

## 6. ### Delivery evidence and post-merge measurement

- [x] 6.1 On the real PR: push a temporary commit adding a one-line comment to `backend/build.sbt` and one `backend/src` file, confirm a small "compiling N" count in the log (D2), wait for CI, capture `gh api .../actions/caches` filtered to `refs/pull/<N>/merge` (neither `sbt-*` nor `backend-compile-v3-*` entry), then revert (AC3)
- [x] 6.2 Capture the janitor `--dry-run` deletion list against the live cache in the PR evidence (shown to the driver before merge)
- [x] 6.3 Write the driver's post-merge commands into the PR body: AC1 usage + per-family breakdown >= 24 h after merge, AC2 `refs/tags/*` listing after the next `v*` deploy, AC4 default-setup languages, D5 closed-PR ref has 0 entries and main count unaffected, AC5 backend/e2e job medians over 5 green main runs
