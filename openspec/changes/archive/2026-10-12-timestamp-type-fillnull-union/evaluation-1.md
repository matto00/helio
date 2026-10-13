## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `f853b0f3d57c3af397463754f28ad297db8960d0` (diff base resolved live: `62164029270bcaadfc0fde2b0f43263cd1314b03`).

### Phase 1: Spec Review — FAIL

- AC1 (fillnull mean/median decision) and AC2 (union decision): implemented as designed (D1/D2, analyze step error, projection unchanged). Flagged as assumed product calls in proposal/design. PASS.
- AC3 (parity tests red pre-fix, green post-fix): independently reproduced, see Phase 2. PASS.
- AC4 (doc updated to shipped behaviour): mostly honest, but has one inaccurate sentence. See CR4.
- Tasks: all ticked, and they match the diff.
- C1 (red first): reproduced. Reverting the three main-source files to the base and running `TimestampNumberParitySpec` and `PipelineServiceCanRunSpec` gives 8 failures: the 6 analyze RED tests, the "name only the timestamp columns" test and the 3.3 canRun test. All 6 run-side tests passed, with no "Lane reference not found" error, and the run side calls `executeTree`. The failing assertions are the analyze ones, as `red-evidence.md` claims. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1491/evidence/openspec/changes/timestamp-type-fillnull-union/.eval-red.txt`.
- C2 (no run-time change): `FillNullStep.scala` only gains a `val` and a message `def`, both used only by analyze. `UnionStep` is untouched. `apply` and `evaluate` are unchanged. PASS.
- C3 (guards failable by a recorded mutation): I confirmed this myself (see Phase 2). However, `mutations.log` matches `.gitignore:27` (`*.log`), so the recorded mutations are **not in the commit**. They will be lost at cleanup, even though `files-modified.md` lists the file. See CR3.
- C4: `[hel1468-guard]` appears in every sbt run I did. No new DB spec was added: `PipelineServiceCanRunSpec` is an existing spec with its existing harness. There is one new inline FQN (see CR2).
- **Spec divergence:** `specs/pipeline-union-op/spec.md` (ADDED requirement) says the message "SHALL name every such field and both of its types". `MultiInputSchemaInference.timestampNumberCollision` ends in `.headOption` (`MultiInputSchemaInference.scala:85`), so it names only the first colliding field. No test covers two collisions. The fillnull side does name every column, as its spec requires. See CR1.

### Phase 2: Code Review — FAIL

Gates I ran myself (backend-only diff, so the frontend gates were not triggered):
- Targeted `testOnly` across 20 suites: TimestampNumberParitySpec, PipelineServiceCanRunSpec, PipelineAnalyzeServiceSpec, AnalyzeSchemaWarningsSpec, PipelineAnalyzeSchemaWarningsSpec, PipelineAnalyzeRoutesSpec, PipelineAnalyzeCanRunRoutesSpec, PipelineAnalyzeJoinCollisionSpec, CastRuntimeParitySpec, InProcessPipelineEngineSpec, InProcessPipelineEngineTreeWalkSpec, StepConfigErrorClassificationSpec, StepEnumWriteValidationSpec, StepConfigInvalidRoutesSpec, PipelineStepSpec, PipelineStepRequiredConfigSpec, DuplicateStepReferenceChecksSpec, PipelineCostEstimatorSpec, PipelineProposalServiceValidateSpec and CsvBlankCellsNullStepsSpec. Result: 683 succeeded, 0 failed, and `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` (ref `/home/matt/Development/helio/.concertino/runs/HEL-1491/evidence/openspec/changes/timestamp-type-fillnull-union/.eval-run1.txt`). The repo has no dedicated `StepConfigValidation*Spec` or fillnull/union step spec file. The fillnull/union coverage lives in the suites above. I did not run a full `testFull`: the executor ran one, and the brief caps machine-wide full runs.
- `npm run check:scala-quality`: clean. Its FQN regex does not cover `scala.util.*`, which is why CR2 got through.
- Scalafmt: the backend has no scalafmt plugin or `.scalafmt.conf`, so a standalone scalafmt check does not apply. `prettier --check` on `docs/compute-expression-grammar.md` and the change dir passes, which covers the `format:check` scope this diff touches.
- Mutations re-applied (each restored afterwards; the tree is clean):
  - M1 (fillnull flags every strategy) plus M3 (union flags any type difference): 11 tests went red. These were the forwardFill/mode/constant guards, the 6 union other-collision guards, the "does not share a name" guard, and the 3.3 canRun forwardFill half (ref `.../.eval-mut1.txt`).
  - M5, my own (union check ignores name matching, comparing every parent field against every secondary type): exactly 1 test went red, "report no error for a collision that does not share a name" (ref `.../.eval-mut2.txt`). This settles the executor's own concern. The test name is misleading, but the test is the **only** guard on the name-match requirement. It does exercise it: the parent's `ts: timestamp` and the secondary's `other: integer` do not share a name. The extra `ts` string/timestamp collision in the fixture is incidental. Non-blocking rename below.
- Consumers of a new `validationError`: `PipelineCreateTransaction` and the proposal paths use only `outputSchema`, and the projection is unchanged, so create and apply-proposal are unaffected. On the frontend, `StepCard.tsx:199` (`InlineError` for non-compute ops) and `StepCardHeader.tsx:78` render any step `validationError` generically, which confirms that no UI change is needed.

Issues:
1. `MultiInputSchemaInference.scala:85`: `.headOption` diverges from the spec's "name every such field" (CR1).
2. `StepSchemaInference.scala:71`: new inline FQN `scala.util.Try(...)`. This breaks CONTRIBUTING.md:70 ("never inline a fully-qualified name when an import would do") and the binding owner rule "no inline FQNs". A pre-existing occurrence at `MultiInputSchemaInference.scala:104` is not a licence to add another (CR2).
3. Mutation evidence is uncommitted because of `*.log` in `.gitignore` (CR3).

DRY, readability, modularity, type safety, error handling (a decode failure is tolerated and left to `validateStepConfig`) and dead code all pass otherwise.

### Phase 3: UI Review — N/A

No trigger matched: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed. Generic rendering was verified by source reading (Phase 2).

### Overall: FAIL

### Change Requests
1. **Union message must name every colliding field** (spec-divergence). `backend/src/main/scala/com/helio/domain/engine/MultiInputSchemaInference.scala:77-86`: collect every qualifying collision instead of taking `.headOption`. For example, build `Vector[(name, parentType, secType)]` and, when it is non-empty, return one message listing each `'name' (parentType vs secType)`. Keep one message so the rest of the analyze channel is unchanged. Add a test to `TimestampNumberParitySpec` with two collisions (e.g. `ts` timestamp/integer and a second field float/timestamp) that asserts both names and all types appear. Confirm it goes red against the current `.headOption` code, and record that. Or, if the owner-facing choice is "first field only", amend `specs/pipeline-union-op/spec.md` instead. Code and spec must agree.
2. **Remove the inline FQN** at `backend/src/main/scala/com/helio/domain/engine/StepSchemaInference.scala:71`: add `import scala.util.Try` to the top-of-file imports and use `Try(FillNullConfig.decode(config))`.
3. **Commit the C3 mutation evidence.** `openspec/changes/timestamp-type-fillnull-union/mutations.log` is ignored by `.gitignore:27` (`*.log`), so it is not in the commit even though `files-modified.md` lists it. Rename it to a tracked name (e.g. `mutations.md`), add the CR1 mutation to it, and update `files-modified.md`.
4. **Fix the inaccurate doc sentence.** `docs/compute-expression-grammar.md:368` says "The projected type stays `timestamp` (the erroring step's output schema is its input schema)". That is wrong for the reverse union direction you document two bullets earlier ("or the reverse"): when the parent is `integer`/`float`, the projection stays numeric and timestamp strings arrive under it. It is also wrong for a lane union in general, whose output is the input plus secondary-only fields. Reword it to "The projected type is unchanged (the parent lane's type for a union, the input type for fillnull)", and state the reverse case's consequence. Keep the `$ts + ...` sentence scoped to the timestamp-parent case.

### Non-blocking Suggestions
- `TimestampNumberParitySpec.scala:156`: rename "report no error for a collision that does not share a name" to something accurate, such as "report no error when the timestamp and numeric fields have different names". The test is valuable: it is the only guard that goes red under a name-insensitive mutation.
- The save-path guard (`rawConfigProblem` accepts fillnull mean) has no recorded mutation. Consider recording one (e.g. a write-time rejection) in the renamed mutations file.
