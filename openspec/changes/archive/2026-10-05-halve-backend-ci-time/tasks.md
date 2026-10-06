## Standing Constraints

- [C1] Local test runs: `nice -n 19`, `HEL924_TEST_GROUP_CONCURRENCY<=2`, Bash timeout 600000; `sbt --client shutdown` is its own Bash call.
- [C2] No test removed without a `removed-tests.md` row naming the surviving test (file:line); no removal/weakening to fix a flake; `HelioRouteTest`/`RouteTestBaseGuardSpec` untouched.
- [C3] Before/after timings come from CI logs/artifacts, never local runs; local timings only justify per-suite fixes.
- [C4] (retired, replaced by C7) `ci.yml` edits confined to the `backend` job (and `ci-complete` needs if required); never `backend/.sbtopts`.
- [C5] Isolated DBs only via EmbeddedPostgres per fork/suite; never the shared dev DB.
- [C7] `ci.yml` edits limited to: the `backend` job, the single workflow-level `concurrency:` stanza (owned by HEL-1287), and `timeout-minutes` on `frontend`/`security` (job level)/`ci-complete`; HEL-1288 owns e2e; never `backend/.sbtopts`.
- [C6] Owner ruling: backend CI capped at ~4 matrix legs; tune per-leg time inside a leg, never add legs; 2 forks per leg unless 3 is shown stable; if 4 legs can't reach the target without dropping coverage, escalate with measured numbers.

## 1. CI — Baseline profile

- [x] 1.1 Add `actions/upload-artifact` (`if: always()`) of backend JUnit XML reports to the backend job; push; verify the PR run uploads it
- [x] 1.2 From that PR run's log + artifact, write `profile.md` "Before": per-phase timings, test count, top 20 suites with setup-vs-assertion split; verify numbers cite run ids
- [x] 1.3 Generate `backend/project/test-suite-weights.tsv` from the artifact with a committed script; verify it lists every suite in the artifact

## 2. Backend — Redundant and unnecessary tests

- [x] 2.1 Survey candidates (retired features, duplicate assertions, copy-paste variants); for each removal add a `removed-tests.md` row with surviving test file:line; verify every removed test has a row
- [x] 2.2 Remove only ledgered tests; return any candidate without a nameable survivor as ESCALATION; verify `sbt "Test/compile"` passes

## 3. Backend — Sharding

- [x] 3.1 Add `backend/project/TestShards.scala` (LPT partition, env parsing, exactly-once check) and wire into `Test / testGrouping`; verify unsharded `testGrouping` output is unchanged vs main
- [x] 3.2 Verify invalid env (one var only, non-integer, index out of range) fails the build with a clear message
- [x] 3.3 Record a red for the exactly-once guard (temporary mutation dropping one suite) naming the suite, then revert; transcript in `profile.md`
- [x] 3.4 Convert the CI `backend` job to a `shard` matrix (`fail-fast: false`), heap lines unchanged, step comment corrected per D4, sbt dependency cache key equal to main's (D7 revert); verify `ci-complete` needs still cover every leg

- [x] 3.5 Rework the matrix to 4 legs (C6) and add D7 compile-output caching with a recorded local zinc-invalidation probe; verify the 4-shard partition dump covers all suites exactly once

## 4. Backend — Long-running suites

- [x] 4.1 For each top-20 suite, classify cost and apply assertion-preserving fixes (sleeps, patience, fixtures, per-test DB setup); verify local `testOnly` before/after per fix
- [x] 4.2 Template-DB cloning only if D6's conditions hold; otherwise note as follow-up in `profile.md`

## 7. CI — Owner scope additions (concurrency, timeouts, cache hygiene)

- [x] 7.1 Add D10 workflow `concurrency` (PR number group + cancel on pull_request; run_id group otherwise) and `max-parallel: 4`; verify with `actionlint` or a YAML parse
- [x] 7.2 Add D11 `timeout-minutes` to backend legs, frontend, security (job) and ci-complete from measured durations; verify table of expected vs timeout with source run ids
- [x] 7.3 Split the compile cache per D7 into `actions/cache/restore` (all runs) + `actions/cache/save` (push to main, shard 0 only); leave the `sbt-<hash>` key unchanged; verify YAML conditions
- [x] 7.4 Report every cache entry this PR's runs wrote (key, size, ref) incl. setup-sbt's own, and entries written per run; delete nothing
- [x] 7.5 Mandatory live proof: a superseded PR run cancelled by a new push (two run ids: cancelled + succeeded); a YAML parse is not sufficient

## 5. Docs

- [x] 5.1 Rewrite MISTAKES.md "backend CI job takes ~12 minutes" entry to the measured result and shard model; verify the CON-159 note remains

## 6. Tests and verification

- [x] 6.1 Full local `nice -n 19 sbt testFull` (2 forks) green; record test count
- [x] 6.2 Per D8: ≥ 3 green cold runs of the final head (slowest leg ≤ 7.0 min each) + warm exact-hit evidence from run 37387080368 (slowest-leg median ≤ 5.0 min), each run labelled with cache state; per-leg counts reconcile; top 20 "After" in `profile.md` (attempt 3: all backend legs green; run red only from the unrelated security frontend-audit step)
- [x] 6.3 Confirm `RouteTestBaseGuardSpec` and FirstRunRoutesSpec ran and passed in a PR CI leg; report any FirstRunRoutesSpec timeout (local half done: discovered, one shard each, pass; CI half pending)
