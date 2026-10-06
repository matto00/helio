# Backend CI profile (HEL-1287)

All numbers are from GitHub Actions run logs / the JUnit artifact (C3). PR CI runs on the merge ref (PR head + current main),
so the test count moved 5954 -> 5958 when main gained HEL-1256 (4 tests in PatchSetUndoServiceSpec) mid-change; that is not an add by this change.
GitHub Actions was in a declared **major outage** during the later runs (queued legs cancelled after ~15 min with no runner); only legs that actually ran are timed.

## Before (run 37352303257, head 63dc58c8 = artifact upload only, single job, 4 vCPU)
| phase | time |
|--|--|
| runner setup + checkout + setup-java/sbt + cache | ~31 s (17:57:25-17:57:56) |
| sbt boot / build load (dependency resolution, warm cache) | ~21 s |
| compile (444 sources) | 70 s |
| test-compile (434 sources) | 74 s |
| ScalaTest execution | 14 min 49 s (5954 tests, 416 suites) |
| job total | 18 min 28 s |

Earlier post-#769 baseline from the ticket premise check: 12m39s (run 37347856913); this run's runner was slower. **Root cause of the serial test stage (probe-confirmed):** `show Global/concurrentRestrictions` prints both `Limit forked-test-group to 1` (sbt default) and `... to 4` (build.sbt); all limits apply, so the 8 groups ran back to back (JUnit timestamps: groups g1,g6,g5,g0,g2,g7,g4,g3 each 58-131 s, strictly sequential, 18:01:09-18:15:44). Sum of suite `time` was 448 s of 850 s group span: JUnit `time` excludes beforeAll/afterAll, so ~400 s (~1 s/suite, ~206 files start EmbeddedPostgres) is setup, i.e. ~47% of test stage. Per-suite setup is not separable per suite from JUnit (suite-minus-testcase is 0 by construction); the gap-between-suites proxy is in the table below.

### Top 20 suites before (suite `time`, run 37352303257)
| # | suite | suite s | tests |
|--|--|--|--|
| 1 | com.helio.api.ApiRoutesSpec | 35.5 | 172 |
| 2 | com.helio.api.routes.sources.DataSourceRoutesSpec | 21.5 | 146 |
| 3 | com.helio.spark.SparkJobSubmitterSpec | 16.4 | 17 |
| 4 | com.helio.api.AuditMutationInstrumentationSpec | 13.6 | 33 |
| 5 | com.helio.services.workspace.WorkspaceContextServiceSpec | 12.8 | 38 |
| 6 | com.helio.api.http.ExistenceNotLeakedRoutesSpec | 12.3 | 61 |
| 7 | com.helio.api.routes.auth.MfaApiRoutesSpec | 11.2 | 17 |
| 8 | com.helio.infrastructure.persistence.DatabaseConnectionTimeoutSpec | 10.0 | 1 |
| 9 | com.helio.infrastructure.persistence.V98PipelineRootsMigrationSpec | 8.6 | 11 |
| 10 | com.helio.services.pipelines.PipelineRunServiceSpec | 7.4 | 87 |
| 11 | com.helio.infrastructure.persistence.DatasetRowsReaderBehaviorPreservingSpec | 6.6 | 1 |
| 12 | com.helio.services.sources.DatasetWriteSubmitLatencySpec | 6.5 | 3 |
| 13 | com.helio.api.routes.panels.PanelControlsValidationSpec | 6.5 | 45 |
| 14 | com.helio.services.pipelines.DatasetWriteAutoRunEndToEndSpec | 6.4 | 4 |
| 15 | com.helio.api.routes.dashboards.DashboardLayoutRepairRoutesSpec | 6.0 | 17 |
| 16 | com.helio.api.routes.pipelines.PipelineStepRoutesSpec | 5.7 | 88 |
| 17 | com.helio.services.auth.AuthServiceSpec | 5.7 | 13 |
| 18 | com.helio.infrastructure.persistence.V114BackfillSignupEventsSpec | 5.3 | 3 |
| 19 | com.helio.api.routes.pipelines.OutputRoutesSpec | 4.7 | 99 |
| 20 | com.helio.api.routes.panels.AutoLayoutRouteSpec | 4.6 | 13 |

## After (head bada47ae, run 37367715773; 8 legs, 2 concurrent forked groups per leg, 4 groups per leg)
Config: `ci.yml` backend matrix shard 0..7, `HELIO_TEST_SHARD_COUNT=${{ strategy.job-total }}`, `HEL924_TEST_GROUP_CONCURRENCY=2`, `HEL924_TEST_GROUP_COUNT=4`.
Per-leg job wall (startedAt-completedAt, jobs that ran), tests, ScalaTest time:
| leg | wall | tests | ScalaTest |
|--|--|--|--|
| 0 | 261 s | 647 | 1m25s |
| 1 | 285 s | 679 | 1m20s |
| 2 | 345 s | 939 | 1m55s |
| 3 | 289 s | 729 | 1m38s |
| 4 | 225 s | 580 | 1m15s |
| 5 | 294 s | 662 | 1m29s |
| 6 | 296 s | 740 | 1m31s |
| 7 | 246 s | 982 | 1m32s |

Sum of tests = 5958 = 5954 (before) + 4 (HEL-1256 from main) - 0 removed + 0 added. 416 suites, all legs green; no "Java heap space" in any leg; no FirstRunRoutesSpec timeout in any leg (grep of every leg log).
Typical leg anatomy (slow runner): setup 27 s, sbt boot 21 s, compile ~65 s, test-compile ~65 s, tests 80-115 s, post ~15 s. Compile+test-compile (~2.2 min) is now the largest fixed cost.

Earlier configurations measured (same branch): 4 legs/2 forks: slowest 6:12 (all runners slow class, 1.3x test-stage inflation); 6 legs: 6:01 (36 s runner lag); 8 legs: 5:22; 8 legs/3 forks: 5:18 (no gain over 2 forks); 12 legs/3 forks: queued behind the shared runner pool for 5+ min and `ConnectorCompletionServiceSpec` "refuse an expired token, then a re-mint ..." failed once (its 50 ms expiry races under load; not weakened, concurrency returned to 2). A scalac `-Ybackend-parallelism` knob was tried and dropped (no effect on slow runners).

### Top 20 suites after (run 37367715773 artifacts)
| # | suite | suite s | sum testcase s | setup proxy | tests |
| 1 | com.helio.api.ApiRoutesSpec | 46.4 | 46.4 | 0.0 | 172 |
| 2 | com.helio.api.routes.sources.DataSourceRoutesSpec | 46.2 | 46.2 | 0.0 | 146 |
| 3 | com.helio.api.AuditMutationInstrumentationSpec | 27.6 | 27.6 | 0.0 | 33 |
| 4 | com.helio.spark.SparkJobSubmitterSpec | 24.6 | 24.6 | 0.0 | 17 |
| 5 | com.helio.api.routes.auth.MfaApiRoutesSpec | 16.4 | 16.4 | 0.0 | 17 |
| 6 | com.helio.services.workspace.WorkspaceContextServiceSpec | 15.6 | 15.6 | 0.0 | 38 |
| 7 | com.helio.api.http.ExistenceNotLeakedRoutesSpec | 12.6 | 12.6 | 0.0 | 61 |
| 8 | com.helio.infrastructure.persistence.V114BackfillSignupEventsSpec | 12.3 | 12.3 | 0.0 | 3 |
| 9 | com.helio.services.pipelines.PipelineRunServiceSpec | 11.9 | 11.9 | 0.0 | 87 |
| 10 | com.helio.services.sources.DatasetWriteSubmitLatencySpec | 11.6 | 11.6 | 0.0 | 3 |
| 11 | com.helio.api.routes.panels.PanelControlsValidationSpec | 11.4 | 11.4 | 0.0 | 45 |
| 12 | com.helio.services.auth.AuthServiceSpec | 10.8 | 10.8 | 0.0 | 13 |
| 13 | com.helio.infrastructure.persistence.DatabaseConnectionTimeoutSpec | 10.6 | 10.6 | 0.0 | 1 |
| 14 | com.helio.infrastructure.persistence.V98PipelineRootsMigrationSpec | 10.3 | 10.3 | 0.0 | 11 |
| 15 | com.helio.api.routes.pipelines.PipelineStepRoutesSpec | 10.3 | 10.3 | 0.0 | 88 |
| 16 | com.helio.api.routes.pipelines.OutputRoutesSpec | 8.5 | 8.5 | 0.0 | 99 |
| 17 | com.helio.api.routes.panels.PanelCreatePlacementSpec | 8.3 | 8.3 | 0.0 | 20 |
| 18 | com.helio.api.routes.panels.FormPanelRoundTripSpec | 8.3 | 8.3 | -0.0 | 22 |
| 19 | com.helio.services.patchsets.PatchSetApplyServiceSpec | 7.7 | 7.7 | 0.0 | 46 |
| 20 | com.helio.api.routes.panels.FormSubmitRoutesSpec | 7.7 | 7.7 | 0.0 | 29 |

## Guard red (exactly-once partition), task 3.3
```
### MUTATION: shard 0 assignment drops its first suite
[error] java.lang.RuntimeException: Test shard partition is not exact -- assigned to NO shard: com.helio.api.ApiRoutesCorsErrorHandlingSpec
[error] 	at scala.sys.package$.error(package.scala:28)
[error] 	at $Wrap0a189272c1$.$anonfun$18(build.sbt:148)
exit=1
```
Mutation (temporary, reverted): shard 0's assignment dropped its first suite; build failed naming it. Green: union of shards 0-3 of 4 equals all 416 discovered suites with no duplicates (diff against unsharded group dump: identical).

## Invalid env (task 3.2)
```
=== HELIO_TEST_SHARD_INDEX=1
[error] java.lang.RuntimeException: HELIO_TEST_SHARD_INDEX and HELIO_TEST_SHARD_COUNT must be set together (or both unset)
[error] 	at scala.sys.package$.error(package.scala:28)
[error] 	at $Wrapaa2b37a810$.$anonfun$13(build.sbt:140)
[error] 	at scala.util.Either.fold(Either.scala:201)
exit=1
=== HELIO_TEST_SHARD_COUNT=4
[error] java.lang.RuntimeException: HELIO_TEST_SHARD_INDEX and HELIO_TEST_SHARD_COUNT must be set together (or both unset)
[error] 	at scala.sys.package$.error(package.scala:28)
[error] 	at $Wrapaa2b37a810$.$anonfun$13(build.sbt:140)
[error] 	at scala.util.Either.fold(Either.scala:201)
exit=1
=== HELIO_TEST_SHARD_INDEX=x HELIO_TEST_SHARD_COUNT=4
[error] java.lang.RuntimeException: HELIO_TEST_SHARD_INDEX is not an integer: 'x'
[error] 	at scala.sys.package$.error(package.scala:28)
[error] 	at $Wrapaa2b37a810$.$anonfun$13(build.sbt:140)
[error] 	at scala.util.Either.fold(Either.scala:201)
exit=1
=== HELIO_TEST_SHARD_INDEX=4 HELIO_TEST_SHARD_COUNT=4
[error] java.lang.RuntimeException: HELIO_TEST_SHARD_INDEX must be in [0, 4), got 4
[error] 	at scala.sys.package$.error(package.scala:28)
[error] 	at $Wrapaa2b37a810$.$anonfun$13(build.sbt:140)
[error] 	at scala.util.Either.fold(Either.scala:201)
exit=1
=== HELIO_TEST_SHARD_INDEX=0 HELIO_TEST_SHARD_COUNT=0
[error] java.lang.RuntimeException: HELIO_TEST_SHARD_COUNT must be >= 1, got 0
[error] 	at scala.sys.package$.error(package.scala:28)
[error] 	at $Wrapaa2b37a810$.$anonfun$13(build.sbt:140)
[error] 	at scala.util.Either.fold(Either.scala:201)
exit=1
```

Unsharded grouping (task 3.1): Test/testGrouping dumped from main's build.sbt and this branch's: 8 groups, byte-identical contents (cmp: IDENTICAL).

## Redundancy survey (task 2) -- method and results
Method (all over backend/src/test, 434 files, 416 suites, 5958 tests):
- (a) Duplicate assertions: read ApiRoutesSpec's full test list (172 tests) against the *RoutesSpec files and looked for same-route/same-input/same-outcome pairs. Candidate pairs checked: `update dashboard layout` (PATCH /dashboards/:id) vs `dashboard update endpoint applies layout changes` (PATCH /dashboards/:id/update); `reject appearance updates without payload` vs `dashboard update endpoint returns 400 when no fields`; the two `Protected routes`/`GET /api/auth/me` 401 tests. All hit different endpoints or branches: **kept**. Migration specs (V94/V96/V98/V99/V100/V106/V114, BinaryRefs, TriggerSource, UserTier, ResourceTag) each assert their own migration's data transformation and a distinct `before` fixture; later specs do not re-assert those row transformations (they only use the migrated schema): **kept**. DatasetRowsReaderBehaviorPreservingSpec (1 test, ~11 s) pins reader output against the pre-refactor reader and has no other test with its assertion: **kept**.
- (b) Retired code: for each of the 416 specs, checked whether the spec name (or a leading CamelCase prefix) matches any identifier in backend/src/main; the 106 non-matches were reviewed by name: they are guard/regression/integration specs (RLS, migrations, *Routes* clusters, apply-proposal cluster) naming behaviour not a class, none names a removed class. No spec file exists for the retired DataType/Metric/bound-panel routes except ApiRoutesSpec "retired DataType/Metric/bound-panel routes (HEL-904)", which asserts the routes 404 (a guard that the retirement holds, not a test of retired code): **kept**. PatchSetProtocolSpec's `target.kind = 'dataType'/'metric'` rejection tests assert the retirement in the patch-set protocol: **kept**.
- (c) Copy-paste variants: a script normalised every test body (string and numeric literals replaced) and grouped identical bodies longer than 150 chars: 53 groups. Reviewed each group. Almost all differ in what they call (different op names, different methods: e.g. DataSourceServiceSpec createTextUrl/createPdfUrl/createImageUrl; PipelineAnalyzeServiceSpec per-op malformed config; /rows vs /rows/aggregate) or in which branch a literal reaches (AssertStepSpec rowCountMin vs rowCountMax; FilterStepSpec per-operator; CsvUrlFetchSpec per address class): **kept** (a literal that reaches a different branch is distinct coverage). One true duplicate: DateBucketStepSpec, identical rows, call and assertions in two tests.
- Removed: 1 test (see removed-tests.md). Count 5958 -> 5957 after the removal.
- No candidate was found that seemed worth removing without a nameable survivor, so there is no ESCALATION.

## Long-runner pass (task 4.1), top 20 suites of the after run (CI run 37367715773 artifacts)
Classification from reading each suite (sleeps / eventually / per-test cleanDb / EmbeddedPostgres sites). "No change" = the time is real assertions or per-suite setup that cannot be removed without touching isolation. Local `testOnly` (nice -n 19, 2 forks) only where a change was made.
| suite | dominant cost | action |
|--|--|--|
| ApiRoutesSpec (46 s, 172 tests) | per-test `cleanDb()` (128) + route round trips, 1 EmbeddedPostgres | no change (isolation; ~0.25 s/test) |
| DataSourceRoutesSpec (31 s) | per-test `cleanDb()` (125), multipart uploads | no change |
| SparkJobSubmitterSpec (28 s contended) | two fixed `Thread.sleep(3000)` waiting for async Spark runs, plus real Spark | **no change (tried and reverted)**: a poll on `pipelines.lastRunStatus` raced, because SparkJobSubmitter writes that column before `updateRunTerminalInternal`, so the poll could return while the run row was still Running (a new flake window); reverted per owner ruling `revert-to-sleep`. The fixed sleeps stay; the spec is byte-identical to origin/main |
| WorkspaceContextServiceSpec | 38 tests over one shared DB, real queries | no change |
| ExistenceNotLeakedRoutesSpec | 61 route round trips, shared DB | no change |
| MfaApiRoutesSpec | per-test cleanDb (19), password hashing (bcrypt/argon cost) | no change |
| AuditMutationInstrumentationSpec | `eventuallyAuditRows` polls at 25 ms with a 2 s deadline (already condition-based, not fixed) | no change |
| DatasetWriteSubmitLatencySpec | measures latency by design (timing is the assertion) | no change |
| PipelineRunServiceSpec (87), OutputRoutesSpec (99), PipelineStepRoutesSpec (88) | many cheap round trips on one DB; OutputRoutesSpec has one 200 ms sleep and 4 `eventually` | no change (sleep is a negative-wait: asserting nothing happened) |
| PanelControlsValidationSpec, PanelCreatePlacementSpec, FormPanelRoundTripSpec | pure routes with no EmbeddedPostgres of their own; time is contended-CPU inflation | no change |
| V98PipelineRootsMigrationSpec, V114BackfillSignupEventsSpec | each test migrates to a prior version then applies the migration (Flyway per test, 6 / 3 Postgres starts) | no change (the per-test fresh DB IS the isolation of a migration test) |
| DatabaseConnectionTimeoutSpec | deliberate 5 s HikariCP timeout against a blackhole socket | no change (the timeout is the assertion) |
| DatasetRowsReaderBehaviorPreservingSpec | one test comparing against the legacy reader over a large fixture | no change |
| AuthServiceSpec, PatchSetApplyServiceSpec, FormSubmitRoutesSpec | per-test cleanDb / shared DB | no change |

Other fixed sleeps in the tree (23 total) are 2-500 ms ordering/negative waits (e.g. ConnectorCompletionServiceSpec's `Thread.sleep(100)` past a 50 ms expiry, which is the very timing-sensitive test; not touched).

**D6 template-DB cloning: conditions NOT both met.** Setup is ~47% of test time (condition 1 met), and sharding alone currently lands the slowest leg at ~5.3-5.7 min on slow runners (condition 2 arguably met). But D6 scopes it "only inside an existing shared harness", and there is none: 211 `EmbeddedPostgres...start` sites across ~206 files each build their own. Doing it would mean touching ~200 specs, so it stays a **follow-up**.

## Local verification
- Task 6.1: `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt -batch testFull` (HEAD before the DateBucket removal): `Run completed in 4 minutes, 10 seconds. Total number of tests run: 5958. Suites: completed 416, aborted 0. Tests: succeeded 5958, failed 0.` exit 0. (After the removal the expected count is 5957; the three affected suites plus RouteTestBaseGuardSpec and FirstRunRoutesSpec re-ran green.) `sbt --client shutdown` run separately afterwards.
- Task 6.3 (local): the shard dump for 8 shards assigns RouteTestBaseGuardSpec to shard 4 and FirstRunRoutesSpec to shard 0, each in exactly one shard (8 shards total 416 suite lines, 0 duplicates); `testOnly RouteTestBaseGuardSpec FirstRunRoutesSpec DateBucketStepSpec`: 3 suites, 25 tests, 0 failed.


## Cycle 2: 4-leg cap (C6), compile cache (D7), D6 estimate

### Runner concurrency (C6 rationale)
GitHub's documented limit for the Free plan is 20 concurrent jobs per account (GitHub Docs, "Usage limits", self-described; I could not confirm this account's plan: `GET /orgs/matto00` is 404 for a user account and the plan endpoint needs `admin:org`). Observed consistent with a shared pool but not proof: the 12-leg run queued legs for 5+ minutes (and ~15 min before auto-cancel) and the 8-leg runs started legs one after another; GitHub Actions was also in a declared major outage at the time, so those observations are confounded. Backend + e2e ~8 legs per the owner ruling, so the matrix is now `shard: [0, 1, 2, 3]`, 2 forks per leg, 4 groups per leg (3 forks flaked ConnectorCompletionServiceSpec once, so not raised).

### 4-shard partition (task 3.5)
`HELIO_TEST_SHARD_COUNT=4` dumped for shards 0-3 with the committed weights (from run 37367715773): 416 suite lines, union 416, 0 duplicates. Predicted balance, using that run's per-suite JUnit times:
| shard | suites | tests | sum suite time | + ~1 s/suite setup |
|--|--|--|--|--|
| 0 | 104 | 1445 | 171 s | 275 s |
| 1 | 104 | 1720 | 171 s | 275 s |
| 2 | 104 | 1455 | 170 s | 274 s |
| 3 | 104 | 1338 | 170 s | 274 s |
Time is balanced to <1 s; test counts differ because weight, not test count, is balanced (sum = 5957 after the removal: 1445+1720+1455+1338 = 5958 pre-removal counts from the pre-removal artifacts). Predicted test stage with 2 forks: ~275 s / 2 = ~2:20 (matches the 4-leg runs seen earlier, 2:08-2:48). Predicted slow-runner leg with a warm compile cache: ~0:27 setup + 0:21 sbt boot + ~0:25 incremental compile + ~2:20 tests + 0:15 post = ~4:10; with no cache restore ~6:00 (the earlier 4-leg run: 5:00-6:12).

### D7 compile-output cache (task 3.5)
`ci.yml` caches `backend/target/out` (excluding any `test-reports`), key `sbt-compile-<os>-hash(backend/src/**, build.sbt, project/*.scala, *.sbt, build.properties)`, `restore-keys: sbt-compile-<os>-`. What sbt 2.0.9 needs (probe-confirmed): `target/out/jvm/scala-2.13.15/helio-backend/{classes,test-classes,zinc,test-zinc,...}` plus `target/out/value` (150 MB tar total); `target/streams` and the sbt 2 disk cache (`~/.cache/sbt`, not in the CI cache paths) are not needed. Test reports live under `target/out/.../test-reports`, excluded so results cannot leak between runs; tests always re-run (`testFull`).
Local probe (empty `-Dsbt.global.localcache` each time so the disk cache cannot mask it; tar of a full build `A.tar` restored into a deleted `target/`):
| scenario | result |
|--|--|
| control: no cache, full `Test/compile` | compiling 444 + 434 sources, 59 s wall |
| P1 restore A, nothing changed | no compile at all, 9.5 s wall |
| P2 restore A, +1 main source, +1 test source | `compiling 1 Scala source` to classes, then `compiling 1 Scala source` to test-classes, 11.7 s |
| P3 restore A, add a public member to RequestValidation (a core object) then `testOnly RequestValidationSpec DateBucketStepSpec` | 1 source recompiled (zinc name hashing: nothing used the new name), 14/14 tests pass |
| P4 restore A, change `RequestValidation.DefaultPanelTitle` value | 1 source recompiled, 11.1 s |
| P5 restore A, delete a test source (OwnerIdGuardSpec) | its class files removed (1 -> 0), no stale class left, compile ok |
(The probes edited sources only temporarily; all reverted, `git status` clean.) Expected CI effect: ~130 s of compile+test-compile per leg becomes ~20-30 s on a hit or partial hit. **CI-measured hit / partial-hit compile times are still unmeasured**; if CI shows no saving the cache is removed. Cold-start caveat: a PR's first run restores the newest `sbt-compile-` entry visible to it (main's, saved by main pushes), so the saving depends on main having populated the cache.

### D6 shared-template-DB estimate (not started; gated on the measured 4-leg+D7 slowest-leg median > 5.0 min)
Measured locally with a temporary probe spec (deleted; no spec edited), 5 repetitions, warm binaries:
- EmbeddedPostgres start 0.38 s (first 0.54), Flyway migrate (115 migrations) 0.24-0.30 s (first 0.54), close 0.14 s -> ~0.8 s per suite instance.
- `CREATE DATABASE x TEMPLATE postgres`: 13 ms.
Saving per suite ~0.75 s locally (~1-1.5 s on slow CI runners, matching the ~1 s/suite setup seen in the profile) minus one shared start+migrate per forked JVM. Spec footprint: 206 test files call `EmbeddedPostgres`; 46 of those create cluster-global roles (`CREATE ROLE`, must stay on their own instance or share role setup), leaving up to ~160 files to convert, plus multi-instance migration specs (e.g. V98, 6 starts) that need a pre-migration schema and would mostly stay. Expected saving: ~160 x ~1.0 s = ~160 s of fork time over the run, i.e. ~20 s per 4-leg leg at 2 forks (~25-30 s on slow runners), ~8-10% of a ~4:10 leg, for ~160 spec edits. Decision input: worth doing only if CI shows the slowest-leg median still above 5.0 min by less than ~30 s; otherwise a follow-up.

### Local verification after the cycle-1 removal
`HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt -batch testFull`: `Run completed in 4 minutes, 6 seconds. Total number of tests run: 5957. Suites: completed 416, aborted 0. Tests: succeeded 5957, failed 0.` exit 0; `sbt --client shutdown` run separately.


## Final configuration, evidence on head H = ff5572da (task group 7)
Config: 4-leg matrix, `max-parallel: 4`, 2 forks per leg, workflow `concurrency` (PR-number group, cancel-in-progress on pull_request; run_id group otherwise), job `timeout-minutes` (backend 15, frontend 20, security 5, ci-complete 2), dependency cache key reverted to main's, compile cache split into restore (all runs) / save (push to main, shard 0, exact-miss only) under `backend-compile-v3-`.

### Three runs of H (run 37391616534, attempts 1-3; every attempt COLD)
Cold is confirmed in each leg log: `Cache not found for input keys: backend-compile-v3-Linux-e6bf...` (no v3 entry exists because PRs never save), compile 444 + test-compile 434 sources in every leg; the old PR-scoped `sbt-compile-v2-` entry (70.40 MiB) is outside the `backend-compile-v3-` prefix and cannot be restored. Execution = started->completed.
| attempt | leg 0 | leg 1 | leg 2 | leg 3 | slowest | ScalaTest per leg | overall |
|--|--|--|--|--|--|--|--|
| 1 | 246 s | 345 s | 281 s | 364 s | 364 s (6:04) | 1:59 / 2:31 / 2:03 / 2:52 | all green, ci-complete success |
| 2 | 292 s | 354 s | 246 s | 355 s | 355 s (5:55) | 2:13 / 2:38 / 1:51 / 2:47 | all green, ci-complete success |
| 3 | 280 s | 244 s | 355 s | 327 s | 355 s (5:55) | 2:15 / 1:54 / 2:40 / 2:27 | all 4 backend legs green; security FAILED (`Frontend audit (frontend/)` step, a dependency advisory, not ours), so ci-complete failure |
Cold slowest leg 6:04 / 5:55 / 5:55 (median 5:55), within the <= 7.0 min no-regression bound (D8a). These are cold, not the target.
Per-leg tests (identical every attempt): 1585 + 1380 + 1528 + 1464 = 5957 (5954 + 4 from main HEL-1256 - 1 removed). RouteTestBaseGuardSpec ran in leg 2, FirstRunRoutesSpec in leg 1, both green in every attempt; "Java heap space": 0 occurrences in any leg; FirstRunRoutesSpec timeouts: 0.
Warm best case (exact hit), from run 37387080368 attempt 2 (head 517b98ea, identical build/test code apart from cache-step YAML): legs 223 / 218 / 213 / 202 s, slowest 3:43. Steady-state main will be partial-hit; the first post-merge main run is cold.
Imbalance (H): suite time per leg in the final artifacts was 129 / 91 / 169 / 159 s with the weights then committed; the weights were regenerated afterwards (see "Weights regenerated" and run 37405371525 below, where the in-sample balance did not carry over).

### Top 20 suites after (final-head artifacts, run 37391616534)
| # | suite | suite s | tests |
|--|--|--|--|
| 1 | com.helio.api.routes.sources.DataSourceRoutesSpec | 42.3 | 146 |
| 2 | com.helio.api.ApiRoutesSpec | 42.1 | 172 |
| 3 | com.helio.api.http.ExistenceNotLeakedRoutesSpec | 25.2 | 61 |
| 4 | com.helio.spark.SparkJobSubmitterSpec | 18.3 | 17 |
| 5 | com.helio.services.workspace.WorkspaceContextServiceSpec | 17.9 | 38 |
| 6 | com.helio.api.routes.auth.MfaApiRoutesSpec | 15.7 | 17 |
| 7 | com.helio.api.AuditMutationInstrumentationSpec | 13.9 | 33 |
| 8 | com.helio.services.pipelines.PipelineRunServiceSpec | 13.1 | 87 |
| 9 | com.helio.api.routes.pipelines.OutputRoutesSpec | 12.4 | 99 |
| 10 | com.helio.infrastructure.persistence.DatabaseConnectionTimeoutSpec | 10.4 | 1 |
| 11 | com.helio.infrastructure.persistence.V114BackfillSignupEventsSpec | 10.1 | 3 |
| 12 | com.helio.infrastructure.persistence.V98PipelineRootsMigrationSpec | 8.8 | 11 |
| 13 | com.helio.api.routes.panels.PanelControlsValidationSpec | 8.2 | 45 |
| 14 | com.helio.services.sources.DatasetWriteSubmitLatencySpec | 7.9 | 3 |
| 15 | com.helio.services.auth.AuthServiceSpec | 7.4 | 13 |
| 16 | com.helio.services.pipelines.DatasetWriteAutoRunEndToEndSpec | 7.0 | 4 |
| 17 | com.helio.services.pipelines.OutputHistoryCostMeasurementSpec | 6.7 | 1 |
| 18 | com.helio.api.routes.firstrun.PersonaTemplateRoutesSpec | 6.3 | 8 |
| 19 | com.helio.api.routes.pipelines.PipelineStepRoutesSpec | 5.9 | 88 |
| 20 | com.helio.services.sources.DataSourceServiceSpec | 5.8 | 63 |

### Timeout table (D11), expected vs timeout
| job | measured execution (run ids) | timeout-minutes |
|--|--|--|
| backend leg | cold 3.4-6.4 min (37382209230, 37387080368, 37391616534); warm 3.4-3.7 | 15 |
| frontend | 296-459 s (37391616534, 37387080368) | 20 |
| security | 60-90 s | 5 |
| ci-complete | 2-4 s | 2 |
e2e untouched (HEL-1288); security step-level timeouts untouched (HEL-1296).

### Cache entries (task 7.4; from `gh api repos/matto00/helio/actions/caches?ref=refs/pull/773/merge`, read-only, nothing deleted by me since the restriction)
Every entry currently on refs/pull/773/merge:
| id | key | size | created | status |
|--|--|--|--|--|
| 8534216644 | `sbt-4d38ac7e...` | 955,535,781 B (911 MB) | 2026-10-05T18:34Z | **LIVE**: this PR's current dependency-cache key (`sbt-` + hash of `**/build.sbt` at this head); every backend leg of runs 37405371525 and 37407554387 logs `Cache restored from key: sbt-4d38ac7e...` (verified in all 8 leg logs); last accessed 2026-10-06T02:42Z |
| 8534380210 | `sbt-782450eb...` | 955,533,443 B | 2026-10-05T18:38Z | orphan (key of an earlier head; backend legs of runs up to 37387080368 restored it); last accessed 23:31Z |
| 8535305793 | `sbt-20d14a1e...` | 955,535,121 B | 2026-10-05T19:00Z | orphan (earlier key iteration); never re-accessed |
| 8535388018 | `sbt-6cb46497...` | 955,538,612 B | 2026-10-05T19:02Z | orphan (earlier key iteration); never re-accessed |
| 8542218070 | `sbt-compile-v2-Linux-e6bf...` | 73,825,753 B (70.4 MiB) | 2026-10-05T23:15Z | orphan: PR-scoped compile cache written by run 37387080368 attempt 1 under the superseded YAML; outside the `backend-compile-v3-` prefix so never restored again |
| 8543510787 | `Linux-X64-java21...-sbt-diskcache-...782450eb...` | 51,342 B | 2026-10-06T00:01Z | setup-sbt's own, live |
| 8535310095 | `...sbt-diskcache-...6cb46497...` | 51,334 B | 2026-10-05T19:00Z | setup-sbt's own, orphan of an earlier key |
| 8534222379 | `...sbt-diskcache-...782450eb...` | 32,142 B | 2026-10-05T18:34Z | setup-sbt's own, orphan |
| 8548264627 | `node-cache-Linux-x64-npm-24868eed...` | 115,399,979 B | 2026-10-06T03:00Z | not ours (frontend/e2e setup-node, key changed with HEL-1319's lockfile) |
No `backend-compile-v3-` entry exists on the PR (PRs only restore). Of the four ~955 MB `sbt-<hash>` entries, 8534216644 is live (above); the other three (8534380210, 8535305793, 8535388018, about 2.9 GB together) are orphans of earlier key iterations (the cycle-1 widened dependency key, then its revert and later build.sbt hashes), plus the 70.4 MiB `sbt-compile-v2` entry 8542218070; the orphans will only age out by GitHub's eviction (7-day / LRU), since I may not delete them (HEL-1299 owns trimming). The broken `sbt-compile-Linux-` entry (15.69 MiB) was deleted by me by exact id 8540724199 before the no-deletion restriction.
Entries written per run: runs of the final YAML wrote 0 compile entries and 0 dependency entries (not verified per run beyond the cache list above), at most one shared setup-sbt diskcache entry per new key. Earlier runs (cycle 1-2 YAML) wrote: 1fd2994c run 37382209230: 1 broken compile entry (deleted); 517b98ea run 37387080368 attempt 1: 1 compile entry (v2, 70.4 MiB).
Expected post-merge writes: (1) one new ~911 MB `sbt-<hash>` entry on main, because this PR changes `backend/build.sbt` and main's key hashes `**/build.sbt` (the PR-scope `sbt-` entries above are not visible to main); (2) one `backend-compile-v3-Linux-<hash>` entry (~70 MiB) per backend-changing push to main, from shard 0 only; (3) the usual setup-sbt diskcache entry.

## Final evidence run 37405371525 (head b0ecdd87 = 53c80581 + merge of main HEL-1319; regenerated weights in effect)
Cold (no `backend-compile-v3-` entry exists). Execution time per leg: 302 / 358 / 366 / 381 s (slowest 6:21). Per-leg tests 1251 + 1481 + 1409 + 1816 = 5957. ScalaTest per leg ranged 2:17-2:54. All jobs green including security (HEL-1319 cleared the audit) and ci-complete.
Honest note on the weights: the in-sample prediction (suite-time spread 8 / 7 s across legs) did NOT carry over to this run. Suite time per leg and test counts moved around (leg 3 ran 1816 tests, leg 0 1251) and the leg wall-clock spread was 79 s (302 s to 381 s), against a predicted near-zero spread. Per-suite times vary run to run (runner class, 2 forks contending), so a regenerated weights file buys little beyond removing grossly stale assignments.

## Remaining, outside this PR
- Post-merge: median of 5 main runs (<= 5.5 min is an acceptance criterion provable only after merge; first main run is cold and seeds the compile entry), PR restore of a main entry, post-merge flake rate.
- Follow-ups: D6 shared template DB (gated on the post-merge median; local estimate in "D6" above), cache pruning (HEL-1299).

## Cycle 3: CI runs of the 4-leg + compile-cache configuration (execution = started->completed; queue = created->started)
Rerun legs report a bogus queue (created_at is from attempt 1); reruns started within seconds. All backend legs of all attempts: 0 occurrences of "Java heap space", 0 FirstRunRoutesSpec timeouts; per-leg test counts 1444 / 1720 / 1455 / 1338 = 5957 (every green run); RouteTestBaseGuardSpec ran in leg 3, FirstRunRoutesSpec in leg 2, all green.

| run (head) | attempt | cache state | leg 0 | leg 1 | leg 2 | leg 3 | slowest | backend queue | result |
|--|--|--|--|--|--|--|--|--|--|
| 37382209230 (1fd2994c) | 1 | cold (no entry; cache key `sbt-compile-Linux-`) | 374 s | 258 s | 385 s | 359 s | 385 s (6:25) | 2-3 s | all green, ci-complete success |
| 37382209230 (1fd2994c) | 2 (rerun) | **exact hit of a broken entry** (15.69 MiB, `target/out` only) | 33 s | 44 s | 38 s | 47 s | n/a | n/a | all four legs FAILED (`Not found: TestShards`); ci-complete failure (gating verified); e2e/frontend/security green |
| 37387080368 (517b98ea) | 1 | cold (key `sbt-compile-v2-`, 70.40 MiB saved) | 311 s | 284 s | 353 s | 237 s | 353 s (5:53) | 2-3 s | all green, ci-complete success |
| 37387080368 (517b98ea) | 2 (rerun) | **exact hit**, no compile or test-compile at all | 223 s | 218 s | 213 s | 202 s | 223 s (3:43) | ~0 | all green, ci-complete success |
Phases, cold (run 37387080368 att. 1, leg 0): compile 56 s, test-compile 51 s, ScalaTest 2:24; leg 1 2:13, leg 2 2:36, leg 3 1:53. Exact hit (att. 2): compile/test-compile skipped, ScalaTest 2:50 / 2:50 / 2:35 / 2:27 (test stage alone is 2.5-2.8 min on these runners; the weights balance suite weight from an 8-leg run, so legs are unequal: cold leg 3 finished 116 s before leg 2).
Not run: a partial hit (a restore from an older key plus changed sources) and a third rerun (C), because of the HOLD; e2e was green on both runs.
Gate numbers: cache-hit slowest leg 3:43 (<5.0 min) so the D6 gate (slowest-leg median of 4-leg+D7 on CI > 5.0 min) is NOT triggered; the cold run, 5:53, would exceed it, so the saving depends on a populated cache. Recommendation: do not start D6 now.
Cache entries: run 1fd2994c wrote 1 entry (`sbt-compile-Linux-e6bf...`, 15.69 MiB, broken; I deleted it by exact id 8540724199 before the v2 key); run 517b98ea attempt 1 wrote 1 entry (`sbt-compile-v2-Linux-e6bf...`, 70.40 MiB, ref refs/pull/773/merge, id 8542218070); attempt 2 wrote none (exact hit). All 4 legs share one key, so only the first finisher saves.

### Live cancellation proof (task 7.5)
X = 122d8d8c (docs only) was pushed and its run 37400092850 was in progress when Y (a docs-only commit adding this section) was pushed to the same PR. Expected and verified below: run 37400092850 concluded `cancelled` (superseded, same PR-number concurrency group); Y's run is the evidence run for the final head and is green (ids recorded in the final report and PR).


### Weights regenerated from the final-head artifacts (task addendum)
Weights now = mean suite time of runs 37391616534 (attempt 3) and 37400422292, +1.0 s/suite, via backend/project/gen-test-suite-weights.py logic (artifacts downloaded by exact id). 4-shard dump: every one of 416 suites in exactly one shard (checked: 416 lines, 416 unique, per set of weights). Predicted per-leg suite time (suite time + 1 s setup per suite), measured against run 37391616534 att.3 / run 37400422292 data:

| weights | shard 0 | shard 1 | shard 2 | shard 3 | max-min |
|--|--|--|--|--|--|
| before (committed in H) | 232 / 275 s | 195 / 234 s | 273 / 271 s | 264 / 281 s | 78 / 47 s |
| after (regenerated) | 238 / 268 s | 246 / 260 s | 239 / 266 s | 240 / 266 s | 8 / 7 s |

Caveat: the 'after' balance is in-sample (fit to the same two runs it is scored on); out-of-sample it will be looser. CI confirmation is pending the final evidence run.


## Final run 37407554387 (head 47f581f0, docs-only on top of b0ecdd87) -- verified from leg logs
Cold (no `backend-compile-v3-` entry exists; every leg compiled 444 + 434 sources). Execution time per leg: leg 0 379 s, leg 1 277 s, leg 2 248 s, leg 3 387 s; slowest 387 s (6:27). Per-leg tests, from each leg's "Total number of tests run": leg 0 1251, leg 1 1481, leg 2 1409, leg 3 1816 = 5957 (same split in run 37405371525). Zero "Java heap" lines in all 8 leg logs of runs 37405371525 and 37407554387; the leading `eval` printed maxMemory 3221225472 in every leg; no FirstRunRoutesSpec timeouts. All jobs green, ci-complete succeeded (2 s). Dependency cache: every leg restored `sbt-4d38ac7e...` (live entry 8534216644).

## SparkJobSubmitterSpec change tried and reverted (owner ruling `revert-to-sleep`)
Cycle 1 replaced the two `Thread.sleep(3000)` in SparkJobSubmitterSpec with a poll on `pipelines.lastRunStatus` (local `testOnly` 11.6 s -> 5.9 s). The final skeptic found that SparkJobSubmitter writes that column before `updateRunTerminalInternal`, so the poll can return while the run row is still Running: a new flake window. Reverted: `git checkout origin/main -- backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala`; proof `git diff origin/main -- <that path>` prints nothing (0 lines). Consequently this change contains **no long-runner fix**: every earlier claim in this file of a "real fix", the 11.6 s -> 5.9 s saving, or a modified SparkJobSubmitterSpec is withdrawn. The only test change in the PR is the single duplicate DateBucketStepSpec removal (removed-tests.md). All CI timings above were measured with the sleep-to-poll change in place for SparkJobSubmitterSpec (runs up to 37407554387); it saved ~6 s on one suite of one leg, within run-to-run noise, so no dependent timing or count claim changes (test counts are unaffected: 17 tests either way). Post-revert local check: see below.
Post-revert: `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testOnly com.helio.spark.SparkJobSubmitterSpec`: 17 succeeded, 0 failed, run completed in 12.5 s (the sleeps are back); `sbt --client shutdown` run separately.
