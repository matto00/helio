## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `f78b4c5187a42ead6bf71eb6dce9070b020eda63` (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-scheduler-service-spec/HEL-1286`.
- **File size / structure claims:** `wc -l` = 414. Lines 47-209 are fixture and line 211 opens the single `"PipelineSchedulerService.tick" should {` block. Both claims match the design's Context.
- **Premise (no rollup-hook test):** `grep -ciE 'rollup|productevent'` on the spec returns 0. The production `PipelineSchedulerService.scala` does wire `productEventRollupService` (lines 7, 45-47, 95), so the hook exists in production but this spec never tests it. The premise finding is correct, and treating it as a spinoff candidate (not in scope) is correct under C1.
- **Test count 11:** 9 literal `"..." in {` tests (grep count 9) plus 2 `historyFailureCase("...")` calls = 11. One of the 9 literals is "complete the tick when the retention service itself fails (outer recover)" (line 299), so the split is 8 firing tests and 3 retention-hook tests. This matches the design.
- **Fixture-trait precedent:** `FirstRunRoutesFixture.scala` exists as a `trait` with `protected` members. The planned shape (`extends BeforeAndAfterAll { this: Suite => }`, `private` changed to `protected`) is sound on Scala 2.13.15 (`build.sbt:4`). Moving the strict vals into the trait is also safe: the trait body initialises before the class body registers tests, and every use (`fakeClock`, `historyCtx`, the by-name `FailingHistoryRepo`) is evaluated inside test bodies at run time.
- **Sharding impact:** `backend/project/test-suite-weights.tsv:358` lists only `PipelineSchedulerServiceSpec`. `TestShards.scala:65-66` gives an unlisted suite the median weight (`weights.getOrElse(n, default)`), and the partition check runs over `definedTests`. A new suite therefore needs no tsv edit and cannot be dropped from a shard.
- **Other references:** `DatasetWriteAutoRunCoalescingSpec.scala:41` mentions the spec only in a doc comment (its `FakeClock` convention). Nothing else imports or extends it.
- **Scope:** the change touches only test sources. No API or schema delta is needed, and `skip_specs: true` is appropriate.

### Verdict: REFUTE

Both defects are cheap to fix. Neither one is a design flaw in the split itself. Both sit in the artifacts that the executor and the final gates will check against.

### Change Requests

1. **The planned assertion-line `diff` is non-empty by construction (design.md, "Behaviour-preservation evidence", Assertions bullet; tasks.md 2.2).** The extraction regex (`should`/`shouldBe`/`noException`/`thrownBy`) matches two non-assertion lines in the original:
   - line 24, `import org.scalatest.matchers.should.Matchers`
   - line 211, `"PipelineSchedulerService.tick" should {`

   Design Decision 4 requires both specs to keep that subject line, and both specs must import `Matchers`. The "after" list therefore has 2 more lines than the "before" list, so "must be empty" cannot be met. This forces the executor or evaluator to explain away a red mechanical check, which is exactly the evidence-shaped non-evidence this check is meant to prevent. Revise the check so its expected result is exact and stated in advance. Either:
   - (a) exclude `import` lines and the subject line `"PipelineSchedulerService.tick" should {` from the extraction, then require an empty diff; or
   - (b) keep the regex and state the exact expected diff: exactly two added lines, the subject line and the `Matchers` import, each appearing once more after the split, and nothing else.

   Update tasks.md 2.2 to match.
2. **The new spec has two different names across the artifacts.** `proposal.md:12` says `PipelineSchedulerMaintenanceHooksSpec`. `design.md:34`, `design.md:69` and `tasks.md` 1.5 say `PipelineSchedulerServiceMaintenanceHooksSpec`. Pick one name (the design's name matches the `PipelineSchedulerServiceFixture` naming) and make all three artifacts agree, so the file-name check at the final gate is unambiguous.

### Non-blocking notes

- Decision 2's blanket "`private` members become `protected`" should say **trait-level** members only. `FakeClock`'s own `@volatile private var instant` constructor parameter (line 59) is a member of `FakeClock`, not of the trait, and should stay `private`.
- The class scaladoc (lines 38-44) describes schedule firing only. The design does not say whether it stays on `PipelineSchedulerServiceSpec` (it should) or what one-line doc the hooks spec gets. A short doc comment on the new file is not an assertion change, so it is fine to add.
- For the before/after runtime runs, MISTAKES.md ("sbt 2: `sbt test` can be a cached no-op...") applies. Pass the command as one quoted string, for example `sbt "testOnly com.helio.services.pipelines.PipelineSchedulerServiceSpec"`, and confirm the JUnit XML in `backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/` is fresh. The design already requires a freshness check.
- Comparing runtime names must use the JUnit `testcase@name` attribute only. `classname` will legitimately differ for the 3 moved tests.
- Spinoff candidates the design already lists are confirmed real: the unused `dtId` vals (lines 155 and 174) and the missing product-event rollup-hook coverage.
