## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: a2db0f7b67fd41d46489088eabb81be72397353f. Diff base 2f6d44104ec5060c53c7eca7385ba01e6a0f0875, which I resolved live with `resolve-review-base.sh` (exit 0). Three commits: 5fd9d9562 (red spec), 418e34d52 (fix), a2db0f7b6 (docs). The only `src/main` file touched is `PipelineAnalyzeReads.scala`. There is no `frontend/**`, `schemas/` or `openspec/specs` change, so the UI and design step does not apply.

### What I verified (with evidence)

- **The full `analyze` route only moves code.** I read the diff hunk by hunk.
  - The inline `ownerSchemas` traverse became `ownerRootSchemas(...)`. It calls the same `findByIdOwnedByInternal(dsId, ownerId)` with the same `getOrElse(Vector.empty)`, and it still returns `None` when the caller is the owner.
  - The inline owner overlay became `nonOwnerValidity(...)`. The old code was `enabledSteps.flatMap(projections.get).map(copy(validationError = nonOwnerValidationError(s, ownerProjections.get(s.id)...)))`. The new code applies the same per-element copy to the whole `projections` map, then runs `enabledSteps.flatMap(validated.get)`. The elements, their order and the per-step function are all the same.
  - `analyzeNodes` stores `results(step.id) = AnalyzedStep(id = step.id, ...)` (PipelineAnalyzeService.scala:322-323), and `overlay` preserves keys. So looking up by map key is the same as the old lookup by `s.id`. For the owner, the `None` branch returns the caller view unchanged.
- **AC1 (red, then fixed).**
  - The code shows the defect. Before the fix, concise used `projections` built from `findByIdOwned(dsId, user)`, which is an empty schema for a grantee. That gives `Unknown field: amount` on a valid step.
  - The committed red-run.txt (5 of 8 failing) and mutations.txt m1 both show `editor: Vector(Some("Unknown field: amount"))`. I did not re-run the red myself. The code alone shows why it fails, and the evaluator reports an independent reproduction.
  - My fresh run of `Hel1799GranteeConciseAnalyzeSpec` passes all 8 tests (see the gates bullet below).
- **AC2 (no new schema data, no live row count, NOBYPASSRLS).**
  - In concise, `path`, `op` and `warnings` still come from the caller-view `projections` and `AnalyzeSchemaWarnings.compute(nodeInputs, projections, ...)`. Only `validationError` comes from `validated`.
  - That `validationError` goes through `nonOwnerValidationError`. It can only be one of three things: the schema-independent `stepConfigProblem`, an error identical to the caller-view one (which the grantee already received), or the fixed `NeutralStepError`. None of these can carry an owner column name or type.
  - `ConciseAnalyzeNode` has no row-count field. Test 5 asserts the serialized key sets `{nodes}` and a subset of `{path, op, validationError, warnings}`, and that none of amount/flag/float/boolean appears. Test 6a pins that grantee warnings stay `None` while the owner's warnings name the columns. Test 1 pins `current_user = helio_app_test` with `rolbypassrls = false` and `rolsuper = false`.
  - The grantee now gets strictly less than before: main leaked `Unknown field: flag`.
- **AC3 (stranger).** `analyzeConcise` still returns `Left(NotFound("Pipeline not found: <id>"))` from `findByIdShared` before any root read, and that code is unchanged. Test 7 asserts the exact value, and mutation m4 kills it.
- **Owner rulings (HEL-1661).**
  - The owner's schema decides validity: `ownerRootSchemas` reads the roots through the owner.
  - Grantees get no new schema data, and reasons are neutral (shown above).
  - Concise has no row count, live or last-run.
  - Concise and full analyze now share one implementation, and the "agree per step" test covers the owner, editor and viewer across 4 fixtures.
- **Gates, run fresh by me** (`nice -n 19 sbt -J-Xmx3g testOnly *Hel1799GranteeConciseAnalyzeSpec *Hel1661GranteeAnalyzeVerdictSpec *PipelineAnalyze* *ComputeOptionalTypeAnalyzeSpec`, lane DB env):
  - Exit 0, `Tests: succeeded 243, failed 0`.
  - The specs that ran include Hel1799, Hel1661, PipelineAnalyzeRoutesSpec, PipelineAnalyzeCanRunRoutesSpec, PipelineAnalyzeConciseByteBudgetSpec, PipelineAnalyzeSchemaWarningsSpec, PipelineAnalyzeUpsertSourceSpec and the other PipelineAnalyze* specs.
  - Output: /home/matt/Development/helio/.concertino/scratch/HEL-1799/skeptic-tests.txt
  - I relied on the evaluator's pasted full-suite run (10,208 tests over 6 shards, 0 failed) and did not repeat it. The change touches one file, and the specs that cover it ran green for me.
- **Spec delta** (`specs/pipeline-analyze-api/spec.md`) matches the implementation, with scenarios for valid, owner-only-invalid, concise/full agreement and stranger.

### Verdict: CONFIRM

### Non-blocking notes
- In `analyzeConcise`, `projections.get(s.id.value).map { analyzed => ...` no longer uses `analyzed`. It is kept only to preserve the "absent node" filter. It could become `.filter(projections.contains)`, or it could use `validated`, which has the same keys. This is cosmetic.
- `PipelineAnalyzeReads.scala` is now 367 lines, over the soft budget. The file was already over budget before this change.
