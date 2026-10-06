## Context

See proposal.md — Why. `PipelineSchedulerServiceSpec` (backend/src/test/scala/com/helio/services/pipelines/) is one
`AnyWordSpec with Matchers with BeforeAndAfterAll` class: lines 45-209 are fixture (embedded Postgres + Flyway,
repos, `PipelineRunService` with a `fakeFileSystem`, `FakeClock`, hang-entry overlap machinery, `cleanDb`, `seedUser`,
`seedStaticPipeline`, `seedCsvPipeline`, `seedSchedule`); lines 211-413 are one `"PipelineSchedulerService.tick" should`
block holding 8 schedule-firing tests and the HEL-1272 retention-hook tests (`historyFailureCase` x2,
`FailingHistoryRepo`, "complete the tick when the retention service itself fails (outer recover)"). The ticket's
"product-event rollup hook" concern is not present in this spec (premise-validation evidence). Precedent for a shared
test fixture trait: `api/routes/firstrun/FirstRunRoutesFixture.scala` (`trait ... ` mixed into two specs).

## Goals / Non-Goals

**Goals:** two concern-focused spec files sharing one fixture trait; byte-for-byte identical test bodies, test names
and assertions; identical runtime test count.

**Non-Goals:** new tests/assertions, production changes, fixing anything found (spinoffs only), touching
`ci.yml`/`playwright.config.ts`/`.gitignore`.

## Decisions

1. **One trait, `PipelineSchedulerServiceFixture`, same package, test sources.** It holds everything currently in lines
   47-209 (fixture state, `FakeClock`, `HangEntry`/`hangingReads`/`readCount`, `fakeFileSystem`, `beforeAll`/
   `afterAll`, `await`, `cleanDb`, `ownerId`/`owner`/`user`, all seed helpers). Shape:
   `trait PipelineSchedulerServiceFixture extends BeforeAndAfterAll { this: Suite => ... }` (mirrors
   `FirstRunRoutesFixture`). Alternative rejected: copied setup in each spec — explicitly rejected by the HEL-1272
   evaluator and the AC. Alternative rejected: a shared `object` with one Postgres for both suites — introduces
   cross-suite shared mutable DB state under sbt's parallel forked groups; per-suite instance preserves today's
   isolation semantics exactly.
2. **Visibility: trait-level `private` members become `protected`** in the trait (a `private` trait member is
   invisible to the mixing class). Members of nested classes keep their modifiers (e.g. `FakeClock`'s
   `@volatile private var instant` stays `private`). This is the only permitted edit to moved fixture lines besides
   indentation and placement. The implicit `ec` stays implicit (`protected implicit val ec`).
3. **Split:** `PipelineSchedulerServiceSpec` keeps the 8 schedule-firing tests. New
   `PipelineSchedulerServiceMaintenanceHooksSpec` holds `historyFailureCase`, `FailingHistoryRepo`, its 2 generated
   cases and the outer-recover test. Hook-only helpers (`historyFailureCase`, `FailingHistoryRepo`) live in the hooks
   spec, not the trait, since only it uses them.
4. **Both specs keep the subject string `"PipelineSchedulerService.tick" should {`**, so every runtime test name
   (`PipelineSchedulerService.tick should <name>`) is identical before and after — this is what makes the name
   comparison mechanical rather than judged. Test order within each file preserves the original relative order.
5. **Imports and docs:** each file imports only what it uses; compile must add no new warnings. The existing class
   scaladoc stays on `PipelineSchedulerServiceSpec`; the hooks spec and the trait get a short doc comment (doc comments
   are not assertions).
6. **Moved verbatim, including oddities.** The unused `dtId` vals in both seeders, and any other dead code, move
   unchanged (refactor discipline); they are recorded as spinoff candidates, not fixed.

## Behaviour-preservation evidence (required, produced by the executor)

- **Runtime count & names:** before any edit, run the original suite on the unmodified worktree
  (one quoted command: `sbt "testOnly com.helio.services.pipelines.PipelineSchedulerServiceSpec"`) and capture the
  JUnit XML (`backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/`) `testcase@name` attributes only
  (`classname` legitimately differs for the 3 moved tests); after, run both suites and capture theirs. Sorted name
  lists must `diff` empty; counts equal (expected 11). Verify the run really executed (sbt 2 caching can run zero
  tests — check the XML exists, is fresh, and `tests="N"` > 0).
- **Assertions:** extract every line containing `should`/`shouldBe`/`noException`/`thrownBy` from the original file and
  from the two new files plus the trait, EXCLUDING `import` lines and the subject line
  `"PipelineSchedulerService.tick" should {` (both legitimately appear once per spec after the split), strip leading
  whitespace, sort, and `diff` — the expected result is exactly empty, stated in advance. Also extract test name
  literals (`"..." in {` and `historyFailureCase("...")`) the same way; expected diff empty.
- **Body equality (stronger):** for each test, the body text (whitespace-normalised) in the new files equals the
  original. A simple script comparing the whitespace-stripped concatenation of the moved line ranges is acceptable.
- Persist all of the above as files under the scratchpad (`hel1286-*`) and summarise them in the commit/PR body.

## Risks / Trade-offs

- [Two suites now start two embedded Postgres instances] → small extra wall-clock; same as every other EmbeddedPostgres
  spec; acceptable.
- [Moving into a trait changes initialisation order of vals] → `fakeClock`/`fakeFileSystem`/`hangingReads` are
  strict vals used only after `beforeAll`; trait linearisation initialises them before the class body's tests are
  registered. Verified by the runtime run, not assumed.
- [sbt 2 test caching hides a non-run] → evidence must show a fresh XML with a non-zero count.

## Planner Notes

- Self-approved: naming (`PipelineSchedulerServiceFixture`, `PipelineSchedulerServiceMaintenanceHooksSpec`),
  `private`→`protected`, `skip_specs: true` (no behaviour change).
- Premise drift (minor): the rollup hook is not tested here; adding a rollup-hook test is out of scope (would add
  assertions) and is a spinoff candidate for the final report.
