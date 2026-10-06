## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `f78b4c5187a42ead6bf71eb6dce9070b020eda63`. The planning artifacts are untracked in the change dir. I judged the current artifacts independently and checked every claim against the tree.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-scheduler-service-spec/HEL-1286`.
- **Structure claims (design Context):** I read the whole spec with `cat -n`. It has 414 lines. Lines 47-209 are fixture, line 211 opens the single `"PipelineSchedulerService.tick" should {` block, and the block closes at 413. The fixture inventory in Decision 1 matches lines 47-209 exactly: `ec`, the 9 vars, `FakeClock`, `HangEntry`, `hangingReads`, `readCount`, `fakeFileSystem`, `beforeAll`/`afterAll`, `await`, `cleanDb`, `ownerId`/`owner`/`user`, `seedUser`, `seedStaticPipeline`, `seedCsvPipeline` and `seedSchedule`.
- **Test count and split:** `grep -c '" in {'` returns 9. Adding the 2 `historyFailureCase(...)` calls (lines 296-297) gives 11. The hook tests are lines 270-312: `historyFailureCase`, `FailingHistoryRepo`, the 2 generated cases and the outer-recover test at 299. That leaves 8 firing tests. This matches Decision 3.
- **Round-1 CR1 (assertion diff empty by construction):** fixed. The design and tasks 2.2 now exclude `import` lines and the subject line. I ran the extraction on the original with those exclusions: 34 lines, and none of them is a non-assertion. Both excluded lines (24 and 211) are exactly the ones that would otherwise duplicate after the split. The expected result ("exactly empty") is now stated in advance and is achievable.
- **Round-1 CR2 (inconsistent new-spec name):** fixed. proposal.md, design.md (Decisions 3 and 4) and tasks 1.5 all name `PipelineSchedulerServiceMaintenanceHooksSpec`.
- **Round-1 non-blocking notes:** all addressed.
  - Decision 2 now limits the `private`→`protected` change to trait-level members and keeps `FakeClock`'s inner `private var`.
  - Decision 5 places the scaladoc.
  - The design names the quoted `testOnly` form and the JUnit freshness and non-zero checks.
  - The name comparison uses `testcase@name` only.
- **Visibility needs:** the firing tests use `HangEntry`, `hangingReads`, `readCount`, `db`, `service`, `runRepo`, `scheduleRepo` and `user`. The hook tests use `historyCtx`, `runServiceForHistory`, `pipelineRepo` and `fakeClock`. All of these are trait-level members, so making them `protected` makes them visible to both specs. The implicit `ec` stays implicit.
- **Trait shape precedent:** `FirstRunRoutesFixture.scala:46` is a trait with `protected var`/`val` members, mixed into `FirstRunRoutesSpec` and `PersonaTemplateRoutesSpec`. The `extends BeforeAndAfterAll { this: Suite => }` shape matches the existing `TempDirectorySupport.scala:22` and `ProductTelemetryDbHarness.scala:24`. Scala is 2.13.15 (`backend/build.sbt:4`).
- **References and sharding:** the only references to the spec are:
  - `test-suite-weights.tsv:358`. An unlisted new suite falls back to the median weight, as round 1 confirmed.
  - a doc comment in `DatasetWriteAutoRunCoalescingSpec.scala:41`.
  - a historical archive mapping.

  Nothing extends or imports the spec, so the new suite needs no tsv edit.
- **Pre-commit compatibility:** `check-scala-quality.mjs` hard-fails only on inline FQNs. The 250-line limit is a soft warning, and all three files will be shorter than today's 414. The plan adds no FQNs.
- **Scope:** test sources only, no API or schema delta, and `skip_specs: true` is appropriate. The premise drift (no rollup-hook test) is correctly logged as a spinoff, not added.
- **Driver constraints:** they are reflected in tasks: nice/timeout, scratchpad `hel1286-` prefix, and spinoffs-not-fixes. tasks 2.3 says "<=2 concurrent groups". The build's knob is `HEL924_TEST_GROUP_CONCURRENCY` (`build.sbt` ~175), and when it is unset the default is effectively serial, so either way the cap is met.

### Verdict: CONFIRM

### Non-blocking notes

- **Doc-comment wording:** Decision 5 adds doc comments to the hooks spec and the trait. If either comment contains the word "should", the assertion-line extraction picks it up and the "exactly empty" diff goes red. Avoid that word in the new comments, or expect the evaluator to flag it.
- **JUnit report path:** the path `backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/` does not exist yet in this worktree, because nothing has been built. Its shape matches sbt-2 output seen elsewhere. The executor should take the real path from the actual run instead of assuming it. The design's freshness check already covers a wrong guess.
- **Spinoff candidates (confirmed real):**
  - unused `dtId` vals at lines 155 and 174.
  - no product-event rollup-hook coverage in this spec.
  - `beforeAll`/`afterAll` do not call `super`. This is harmless today, but worth noting once the code lives in a reusable trait. Move it verbatim per Decision 6.
