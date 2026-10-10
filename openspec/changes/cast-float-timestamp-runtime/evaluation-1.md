## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 50cba2868969cf51faeea8bfece8fd6ed5478c62 (base resolved live: 719710c15d457de02bcb681192275f2f011268dc).
Backend-only change (5 production files, 7 test files, change-dir artifacts). No `frontend/**`, `schemas/**`, `ApiRoutes.scala` or `openspec/specs/**` change.

### Fresh evidence gathered by the evaluator

- **Full suite, delivery worktree:** `nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false testFull`. Project path line names the HEL-1436 worktree. `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 6628, failed 0, canceled 4` (the 4 cancels are the existing opt-in `HELIO_MEASURE` perf cases). CastStepSpec, CastRuntimeParitySpec, CastSupportedTargetsSpec and CastTargetWriteRoutesSpec all ran.
- **Independent red run on the unmodified production tree:** a throwaway detached worktree at 719710c15 with only the six new or updated test files copied in. CastSupportedTargetsSpec was left out because it references `CastStep.SupportedTargets` and cannot compile before the fix. Result: exit 1, `[hel1468-guard] failed=29`, `Tests: succeeded 129, failed 29`. **Every failing test is labelled RED, and every RED-labelled test fails.** The failures are for the right reasons. Pipeline: `Vector("1.50","2.25","x") was not equal to List(1.5, 2.25, null)`. Filter: `Vector() was not equal to List("1")`. Routes: `201 Created was not equal to 422`. Warning: `Vector() had size 0 instead of expected size 1`. The relabelled route test ("GUARD: a stored legacy binary-ref cast lists, analyzes ... not gated") passes on the pre-fix tree, so it is correctly a GUARD now.
- **Independent M1 mutation:** I added `.orElse(unsupportedTargetProblem(raw))` to `CastStep.companion.validateRawConfig` on the HEAD tree. Exactly the 6 tests that mutation-evidence.md records went red: both C5 GUARDs, the route-level not-gated GUARD and the three legacy-projection REDs. `[hel1468-guard] failed=6`. The throwaway worktree was removed afterwards (`git worktree list` shows no straggler). No sbt server was started (`-batch`, `autostart=false`).
- `node scripts/check-scala-quality.mjs`: clean (soft warnings only, all pre-existing).
- `openspec validate cast-float-timestamp-runtime --strict`: valid.

### On the red-evidence relabelling (the orchestrator asked about its honesty)

The relabelling is honest, and my own run confirms it.
- "Double epoch → null" was recorded as GUARD but failed pre-fix. It is genuinely RED: pre-fix `date`/`timestamp` passed `"1.7513712E9"` through as a string. It was relabelled RED, and that is disclosed.
- "Long epoch → String form" was recorded as RED but passes pre-fix: the `case _ => str` fallthrough already produced `"1751371200"`. It was relabelled GUARD, and M2 covers it.
- The removed route-test assertion had failed pre-fix only incidentally (`None.get` on an empty source schema), not because of the bug. The behaviour it was meant to pin (legacy targets project the input type) is proven RED in CastStepSpec ("RED: legacy 'X' projects the input type unchanged", which fails pre-fix in my run). The remaining test is a plain C5 GUARD, and M1 proves it can fail. The removal lost no coverage that is not held elsewhere.

### Phase 1: Spec Review — FAIL

Passing items:
- **AC1 (inventory, then handle every accepted type).** The inventory is in design.md. `castValue` handles all 9 `SupportedTargets` explicitly, and the write validator rejects everything else.
- **AC2 (no silent fallthrough).** `case _ => v` is now an explicit, owner-ruled, commented legacy passthrough, and M4 proves it.
- **AC3 (red-first float/timestamp tests, timestamp representation matches other producers).** Met. Timestamp values keep their original string, per owner ruling 3.
- **Owner rulings 1–3 and the 422 status.** All honoured. The 422 is consistent with the shipped `pipeline-step-config-rejection` spec.
- **Analyze/apply parity.** CastRuntimeParitySpec covers 9 targets × 11 inputs. D4a makes analyze project a legacy target as the input type, which matches the runtime passthrough.
- **C5, write-only rejection.** `PipelineStep.rawConfigProblem` → `writeConfigProblem`, and `validateRawConfig` is unchanged. I grepped every `rawConfigProblem` and `validateRawConfig` call site:
  - step create, step update, single-call create, proposal validate and the three patch-set resolvers all go through `rawConfigProblem`.
  - `StepConfigValidation` and `RunConfigGate` call `validateRawConfig` directly, so they never see the new check.
  - M1 proves the gating split.
- **D6 warning-trust flip.** `castRuntimeTargets = CastStep.SupportedTargets.toSet`. The flipped AnalyzeSchemaWarningsSpec join case and the new NumericOpOnTextField RED both fail pre-fix and pass post-fix. The flip is commented, not silently deleted.
- **Spec delta.** The MODIFIED header matches the shipped requirement exactly, and nothing in the shipped analyze or step-config-rejection specs is contradicted.
- **CONSTRAINTS C1–C5.** All honoured. C3: the new embedded-Postgres spec uses `VerifiedEmbeddedPostgres.start`. C4: there is no dev-DB write in the diff.

Issues:
1. **Task 1.6 is marked done, but what was implemented does not match it.** tasks.md 1.6 requires a "pipeline-level test through a REAL in-process run … snapshot rows hold `Double` amounts". `CastRuntimeParitySpec.scala:31-32,90-104` instead drives `InProcessPipelineEngine.executeWithStepCounts` over rows from the production CSV loader. That method's own scaladoc (`InProcessPipelineEngine.scala:204-208`) says it is **test-only**: "No production code path calls this method … `InProcessExecutionBackend` … calls [[executeTree]] exclusively". No run is recorded and no snapshot row is read. The CSV loading is real, and the filter assertion is genuinely red pre-fix. But the "real run → snapshot rows" half of the task (which skeptic-design-3 also anticipated, citing the `InProcessPipelineEngineSpec` CsvSource and embedded-Postgres harness) is missing. The `Double` claim is therefore unproven through `PipelineRowJson` serialisation into `node_snapshots`.

### Phase 2: Code Review — FAIL

The gates are green (see above). Issues:

2. **Orphaned scaladoc, `DateBucketStep.scala:140-161`.** The new `parsesAsDate` scaladoc and def were inserted between the existing 18-line `parseToUtcDate` scaladoc (`:140-157`) and `private def parseToUtcDate` (`:162`). The input-shape contract now sits as a dangling doc block above another doc block, and documents nothing.
3. **D7's "iterates `SupportedTargets` itself" is not implemented, and the guard against drift is circular.**
   - `CastRuntimeParitySpec.scala:36-39` keeps a hand-copied `ParityTargets` literal. That was justified for the red run but is no longer needed now that the constant exists.
   - `CastSupportedTargetsSpec.scala:11` compares `SupportedTargets` to a **third** literal, not to `ParityTargets`. The comment at `CastRuntimeParitySpec.scala:36-37` ("CastSupportedTargetsSpec pins this list to CastStep.SupportedTargets") is therefore false.
   - The consequence: a target added to `SupportedTargets`, with the pin literal updated, never gets a parity case. That is exactly the regression D7 exists to catch.
4. **A test that does not exercise its claim, `NumericOpOnTextFieldWarningSpec.scala:108-114`.** "GUARD … a timestamp cast then a compute neither crashes nor warns spuriously" casts `price` to `timestamp`, but computes `length($s)`. `length` is not a numeric op, and `$s` is not the cast field, so the test would pass whatever the timestamp projection was. Task 1.4 asks for a compute over the timestamp-cast field.
5. **Section dividers in a small file, `CastRuntimeParitySpec.scala:34,68,81,106`.** The `// ---- D7: parity ----` style dividers sit in a 123-line file. CONTRIBUTING.md "Comments" justifies section dividers only in files of roughly 1,000 lines or more.

Checklist:
- DRY: a single `SupportedTargets` constant is reused by the validator, `castValue`, analyze and warnings.
- Readability, modularity, type safety: fine. The `Any` usage is inherent to row maps.
- Security: no new boundary.
- Error handling: the message names every offender and lists the supported targets.
- Dead code: none.
- Over-engineering: none.

### Phase 3: UI Review — N/A

No trigger path changed. No frontend change is needed: `CastFieldsConfig.CAST_TARGET_TYPES` (`string, integer, long, double, boolean`) is a strict subset of `SupportedTargets`, so the picker can never produce a rejected target. The assistant and MCP schemas only show an `integer` example.

### Overall: FAIL

### Change Requests
1. **Task 1.6.** Add a pipeline-level test that goes through the production run path, not the test-only `executeWithStepCounts` oracle. Use a CSV data source (string cells: `amount` `"1.50"`, a timestamp column with one junk value), run cast `{"amount":"float","when":"timestamp"}` and then a `filter amount = 1.5` through a real run, and assert on the persisted output/snapshot rows:
   - the `Double` amount (a JSON number in the snapshot, not the string `"1.50"`);
   - the original timestamp string, and `null` for the junk value;
   - the filter keeping only that row.

   An existing harness to model it on is `ComputeExpressionRunSpec` or the `InProcessPipelineEngineSpec` CsvSource + `VerifiedEmbeddedPostgres` setup. Record its pre-fix failure in red-evidence.md, the way the other REDs were recorded. Keep or remove the existing flat-engine cases at your discretion, but do not count them as 1.6.
2. **`DateBucketStep.scala:158-160`.** Move the `parsesAsDate` scaladoc and def to before the existing `parseToUtcDate` scaladoc block at `:140`, or to after `parseToUtcDate`. The 18-line input-shape scaladoc must sit directly on `private def parseToUtcDate` again.
3. **`CastRuntimeParitySpec.scala:36-39`.** Replace the `ParityTargets` literal with `CastStep.SupportedTargets`, so the parity loop iterates the production constant (design D7). Then:
   - drop or reword the now-false comment at `:36-37`;
   - in `CastSupportedTargetsSpec.scala:9-12`, either delete the literal-pinning case or reword it so it no longer claims to pin the parity list.
4. **`NumericOpOnTextFieldWarningSpec.scala:108-114`.** Make the timestamp GUARD compute over the timestamp-cast field, e.g. `abs($price)` after `{"casts":{"price":"timestamp"}}`, and assert no `numeric-op-on-text-field` warning. That way the test actually exercises the "timestamp family is not pinned, never warns" path D6 relies on.
5. **`CastRuntimeParitySpec.scala:34,68,81,106`.** Remove the `// ---- … ----` section dividers (CONTRIBUTING.md, Comments: dividers only in files of roughly 1,000 lines or more). The `should` block names already carry the grouping.

### Non-blocking Suggestions
- **`PipelineService.duplicateStep` (`PipelineService.scala:2375-2430`) does not call `rawConfigProblem`.** Duplicating a stored legacy-target cast therefore writes a new legacy-target row. This matches pre-existing behaviour (duplicate never re-validated any step kind) and the spec's listed write paths. But design.md's "every write path reaches `rawConfigProblem`" overstates it. Say so in design.md and the PR body, and consider a follow-up ticket.
- **Editing any field of a stored legacy-target cast now returns 422.** The whole `casts` map is validated on PATCH, so a user must also change the legacy target. This is a consequence of owner ruling 2, but the PR body should say it explicitly next to the date-junk→null change.
- **Misleading test name, `CastStepSpec.scala:81`.** The name says "…and the run gate do not report…", but the body never calls `RunConfigGate` (that is in CastRuntimeParitySpec). Rename it to match what it checks.
- **Looser parity check than D7 specifies.** `CastRuntimeParitySpec.familyOk` accepts any non-empty `String` for `timestamp`. D7 specifies "String satisfying the D3 timestamp-like predicate", so asserting the predicate would make the parity check exact.
