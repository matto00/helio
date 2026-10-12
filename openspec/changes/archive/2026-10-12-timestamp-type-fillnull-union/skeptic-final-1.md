## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: 6261e46664d6ffb5f6f2c4d3010df550a4757d44 (squash 47c38562b + archive 560974b32 + merge of origin/main).
Review base resolved live with resolve-review-base.sh: 4d3755079f642726a04dd54edc413c9146429d3a (= merge-base = origin/main).

### What I verified (with evidence)

- **Spawn guard:** assert-cwd.sh printed `READY ambient=/home/matt/Development/helio branch=bug/timestamp-type-fillnull-union/HEL-1491`.
- **Diff scope** (`git diff 4d3755079...HEAD --stat`): three main files (MultiInputSchemaInference.scala, StepSchemaInference.scala, FillNullStep.scala), two test files (new TimestampNumberParitySpec, PipelineServiceCanRunSpec +1 test), docs/compute-expression-grammar.md, two main specs, and the archived change dir. No frontend change, so the UI judgment step does not apply. No migration.
- **Red first, independently reproduced.** I checked out the three main files at 4d3755079 and ran `sbt -batch "testOnly ...TimestampNumberParitySpec ...PipelineServiceCanRunSpec"` (SBT_OPTS=-J-Xmx3g, nice 19). Exit 1, with `[hel1468-guard] ScalaTest summary: failed=9 aborted=0 unreadable=0`, and 33 passed / 9 failed:
  - All 6 `RED: analyze ...` tests (fillnull mean/median, and union ts/int, ts/float, int/ts, float/ts) failed with `expected a validationError on the fillnull|union step`. That is the analyze assertion.
  - All 6 `RED/run-side` tests passed on the pre-fix code. The run writes a number into the filled cell, and the union mixes numbers with timestamp strings. So each failure is for the right reason, and the run side is characterised.
  - The two-collision union test failed (`expected a validationError`), and so did the "name only the timestamp columns" test (`expected an error`).
  - PipelineServiceCanRunSpec's new test failed at line 165 (`true was not equal to false`). That is canRun before the fix.
  - Every GUARD test for unaffected strategies and collisions passed pre-fix, as it should.
  - I restored the files with `git checkout HEAD -- <3 files>`. Status was clean afterwards apart from the untracked evaluation-3.md.
- **Green on the head:** `testOnly com.helio.domain.engine.* PipelineServiceCanRunSpec *PipelineAnalyzeServiceSpec *AnalyzeSchemaWarningsSpec *PipelineAnalyzeRoutesSpec *CastRuntimeParitySpec` gave exit 0 with `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`: 40 suites, 1082 tests, 0 failed. I grepped the log to confirm each named suite header appeared once.
- **Guards can fail (my own mutations):**
  - I widened the union rule to `p.type != s` and the fillnull gate to `if (true)`. That turned 10 GUARD tests red: forwardFill, mode and constant on timestamp; string/timestamp both ways; integer/float both ways; string/integer both ways; and the different-names case. `failed=10` with the guard line present.
  - I then restored the files and confirmed the worktree was clean.
- **Run-time behaviour is unchanged.**
  - FillNullStep gains only a `val NumericFillStrategies` and a pure message `def`. `apply`, computeMean and computeMedian are untouched.
  - Both checks live only in analyze-time schema inference (`inferFillNull`, `timestampNumberCollision`), and their projections are unchanged.
  - Auto-run gates through `RunConfigGate.stepConfigReasons`, which calls the schema-independent `stepConfigProblem` (AutoRunTriggerService.scala:107, RunConfigGate.scala:10-20). The new errors therefore cannot gate auto-runs or scheduled runs.
  - PipelineCreateTransaction.scala:75 reads only `outputSchema` from `analyzeNodes`, and that is unchanged.
  - In the frontend, PipelineDetailFooter.tsx:149 shows "Run to update" only when `canRun`. The Run and Dry run buttons (:321, :330) are disabled only by run status. This matches the design's "flags, does not prevent" claim.
  - The save path is unaffected, pinned by the GUARD test `rawConfigProblem("fillnull", mean) shouldBe None`.
- **AC1 (D1, fillnull):** StepSchemaInference.scala `case "fillnull" => inferFillNull` returns `(inputSchema, Some(msg))` for mean/median when a listed column is projected `timestamp`. Decode failures, absent columns and other strategies are not flagged. This matches design D1 option (b).
- **AC2 (D2, union):** `inferUnion`'s `Some(secondary)` branch keeps the projection and adds the error. The error is symmetric: timestamp against integer/float in either direction. Every colliding field is named with both types. Other collisions are not flagged. This matches design D2 option (c), including the reverse direction.
- **AC3:** the parity tests are red pre-fix and green post-fix, as shown above.
- **AC4 (docs):** the compute-expression-grammar.md section now states:
  - analyze flags both paths, and how;
  - run time is unchanged and not blocked: Run, Dry run, scheduled runs and auto-runs still execute;
  - the projection is unchanged, so `$ts + ...` downstream can still disagree;
  - the reverse union case explicitly: a numeric projection receives timestamp strings;
  - the source-kind union gap ("not checked ... Known gap");
  - what is out of scope.
- **Specs:** pipeline-fillnull-op and pipeline-union-op carry both "flags, not prevents" and the source-kind gap. The stale union passthrough requirement body was corrected to describe source-kind and lane-kind behaviour accurately.
- **Follow-up:** Linear HEL-1520 exists (Backlog). It describes the source-kind union gap and the product call it needs.
- **No inline FQNs:** a grep of added backend lines for `a.b.c.Type` outside import and package lines found nothing.
- **Commit hygiene:** in `git log 4d3755079..HEAD --format=%B`, the only matching trailer is `Co-Authored-By: Claude Opus 5.5`. There are no claude.ai session links and no Claude-Session trailers.

### Verdict: CONFIRM

### Non-blocking notes
- `openspec/changes/archive/2026-10-12-timestamp-type-fillnull-union/evaluation-3.md` is untracked on the head. The orchestrator should commit it with this report.
- TimestampNumberParitySpec has a test "name only the timestamp columns when a mean lists a timestamp and a numeric column". It sits under the `GUARD:` block but is red on pre-fix code, so it is really a RED test. Only the label is wrong; the coverage is fine.
- The pipeline-union-op requirement heading still reads "...is a documented best-effort passthrough", though its body now describes the lane-kind field union. Consider retitling it when HEL-1520 is worked.
