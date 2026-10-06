# HEL-1287: Halve backend CI job time: profile, cut redundant specs, speed up slow ones

## Description

The CI `backend` job takes 9–11 minutes. The owner's observation was "up to 15 min", and this isn't sustainable.
**Target: at most half of today's time.** The job's wall-clock must be **≤ 5.5 min**, taken as the median of 5
consecutive green `main` runs after merge.

**Measured baseline** (as filed), from 5 green `main` runs of `ci.yml` on 2026-10-05:

* The job took 9–11 minutes.
* Of that, the single `Compile and test` step (`sbt "compile; testFull"`) took about 669 s in run 35055008188.
* About 5,900 tests (5,879 locally on HEL-1272).
* The job also hits sbt "Java heap space" while compiling tests. PR #769 / HEL-1273 is raising the heap for this
  job only, so **sequence this after** #769 **merges**, because both edit `.github/workflows/ci.yml`.

**Order of work** (owner: "look for redundant and unnecessary tests, then optimize long-running tests"):

1. **Profile first and commit the evidence.** Split the job's time into dependency resolution, compile, test-compile
   and test execution. Within test execution, rank per-spec durations (JUnit XML reports or the ScalaTest durations
   reporter). Count how much time is embedded-Postgres / Flyway setup per spec versus actual assertions.
2. **Remove redundant and unnecessary tests**: specs that duplicate another spec's assertions, specs for retired
   features, copy-pasted variants that add no distinct coverage. For **each** removal, state the spec that still
   covers the behaviour. A removal with no stated remaining coverage needs a driver or owner ruling. Do not delete a
   test to fix a flake.
3. **Optimise the long-running ones.** Candidates to *verify*, not assume: shared per-spec DB/Flyway setup (e.g. one
   migrated template DB cloned per spec); fixed sleeps or long `eventually` timeouts; over-large fixtures; serial
   execution where specs are independent (sbt `Test / parallelExecution`, forking); sbt dependency and compile caching
   across CI runs; splitting the job into parallel shards. Respect the hardware cap locally: `nice -n 19`, ≤ 2
   workers. CI runners may use more.

## Acceptance Criteria

* A profile artefact in the change: before and after per-phase timings, plus the top 20 slowest specs before and
  after.
* The test count before and after, and every removed test listed with its remaining coverage.
* No loss of the HEL-1228 / `RouteTestBaseGuardSpec` guarantees. FirstRunRoutesSpec and the other known flake classes
  must not get worse: report the flake rate over the post-merge runs.
* The ≤ 5.5 min median, measured on `main` after merge. If sharding is used, the measure is the slowest shard plus any
  setup job on the critical path, and `ci-complete` must still gate on all shards.
* Do not edit `backend/.sbtopts` for CI-only needs. Keep CI tuning in `ci.yml`, following the HEL-1273 ruling.

## Folded-in follow-up (conditional)

HEL-1292 (gitignore `backend/.jvmopts`): fold in **only if** this change restructures the CI heap setting; acceptance
is `.gitignore` lists `backend/.jvmopts` and `git check-ignore backend/.jvmopts` confirms it.

## Driver constraints (binding for this run)

* Every removed test names the test that still covers its behaviour; otherwise escalate, do not remove.
* No removing/weakening a test to fix a flake. Keep HEL-1228 guarantees (`HelioRouteTest`, `RouteTestBaseGuardSpec`).
* If the target looks unreachable without dropping real coverage, escalate — never cut coverage to hit the number.
* Parallelised specs needing isolated DBs use EmbeddedPostgres per fork; never the shared dev DB.
* Local runs: `nice -n 19 sbt testFull`, Bash timeout 600000, at most 2 workers/forks. CI is the real measurement;
  before/after numbers come from CI logs. New route specs extend `com.helio.testkit.HelioRouteTest`.
* Edits to `ci.yml` stay in the backend job (and the `ci-complete` needs list); HEL-1288 owns the e2e job.

## Premise Validation (orchestrator, 2026-10-05)

* The filed baseline is stale: run 35055008188 is from 2026-09-16. On 2026-10-05 the backend job took 17m21s–18m30s
  before #769 and **12m39s** on the first post-#769 run (37347856913, head 94e996d3): compile ~40 s, test-compile
  ~38 s, ScalaTest "Run completed in 10 minutes, 30 seconds", 5954 tests. Test execution is ~83% of the job.
* The ≤ 5.5 min absolute target stands (driver-confirmed); it is a ~57% cut from the true post-#769 baseline.
* Despite `-batch`, the post-#769 log still prints "entering thin client ... starting sbt server in the background";
  maxMemory printed 3221225472 and no "Java heap" line appeared.

## Owner scope additions (2026-10-05, relayed by the driver; the Linear comments were not readable by the orchestrator's tools, so this records the driver's summary)

1. **CI concurrency.** A workflow-level `concurrency:` stanza in `ci.yml`: group per PR ref, `cancel-in-progress` for
   `pull_request` events only; pushes to `main` must never cancel each other. A per-PR limit is enough (the cross-PR
   job-cap proof was dropped; the driver keeps concurrent lanes few). Set `strategy.max-parallel` on the backend
   matrix and state the choice. **Proof:** a superseded PR run is cancelled by a new push.
2. **Job timeouts.** `timeout-minutes` of ~2–3x measured expected duration for the backend legs, `frontend`,
   `security` (job level) and `ci-complete`; the PR lists expected vs timeout per job, from measured durations.
   HEL-1288 owns the e2e legs; HEL-1296 owns the security step-level timeout and the hang's root cause.
3. **Actions cache.** Report each cache entry's size and how many entries a run writes. One shared entry per key, not
   per leg, unless justified; keys chosen so stale entries get evicted. HEL-1299 (filed, blocked by this) owns the
   repo-wide cache budget: do not change the `sbt-<hash>` dependency-cache key again unless required (say why in the
   PR); consider saving the compile cache only on `main` pushes and restoring only on PRs, verifying rather than
   assuming that PR runs restore base-branch entries — or defer that to HEL-1299 and say so in the PR.
