## Standing Constraints

- [C1] Behaviour-preserving import-only refactor: `testFull` green, with an identical total count and sorted test-name list before and after.
- [C2] `sbt testFull` runs as `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` with a Bash timeout of 600000; `sbt --client shutdown` is a separate call.
- [C3] Do not touch `ci.yml`, `playwright.config.ts` or `.gitignore`; escalate rather than widen scope (no other `java.*` packages, no mapper dedup).

### Backend

- [x] 1.1 Baseline: delete the worktree's backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/, run testFull on the untouched tree, and save the console summary, the XML count and the sorted names (hel1332-baseline-*)
- [x] 1.2 Re-derive the hit list with the new prefix set (temporary local probe, not committed); confirm it matches design.md's 131/60 or explain the delta
- [x] 1.3 Fix main-source hits (25 files), collision-checking each simple name per D5 and using rename imports where needed
- [x] 1.4 Fix test hits under `api/`, including the D6a interpolation sites PublicDashboardRoutesSpec:127 and PanelBatchCreateSpec:119
- [x] 1.5 Fix test hits under `infrastructure/persistence/`
- [x] 1.6 Fix the remaining test hits (`services/`, `domain/`, `spark/`)

### Tooling

- [x] 2.1 Update FQN_PREFIXES per D1 and add the load-time trailing-dot assertion (exported validator)
- [x] 2.2 Export `scanScalaText`, add comment stripping per D2, and guard the CLI body per D3
- [x] 2.3 Add `scripts/check-scala-quality.selftest.mjs` covering every D4 case, a `'"'` char-literal pin, and one spawn of the real CLI against a red fixture root
- [x] 2.4 Wire `package.json`: `check:scala-quality` runs the selftest first, and add the `check:scala-quality:selftest` alias
- [x] 2.5 Update CONTRIBUTING.md:236's coverage sentence to name java.sql/java.time/java.util/scala.annotation

### Tests

- [x] 3.1 Red evidence: run the new guard against the base tree (expect about 131 violations) and save the log
- [x] 3.2 Selftest mutation evidence: drop a prefix, restore the dead `java.util.UUID` entry, and remove the comment stripping; each must go red; save the logs
- [x] 3.3 Green: `npm run check:scala-quality` and `npm run check:precommit-ci-parity` pass on the branch
- [x] 3.4 Delete that same sbt-2 test-reports dir and rerun testFull; XML count > 0 and equal to the console total, and names identical to 1.1
- [x] 3.5 Run the D6a raw grep for in-scope prefixes on non-import, non-comment lines; zero code hits remain
