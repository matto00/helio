## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `c957a1eaf052a5c6beeb5a74b435ed62a42826bd`. Diff base resolved live with `resolve-review-base.sh` (exit 0): `37311542aed346150f7eceda407be1560265f546`.
The assumed product call (resolve a `source`-kind union secondary's schema in analyze) is not judged here. It stays parked for OWNER REVIEW. This report judges whether the change is correct, complete, honestly stated and verified.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/union-source-secondary-analyze/HEL-1520`.

**Scope, migration and C1.**
- `git diff --stat 37311542a...HEAD`: 22 files. The main code changes are the two match arms plus comments in `PipelineAnalyzeService.scala`, and comment-only edits in `MultiInputSchemaInference.scala` and `PipelineServiceSupport.scala`. Also changed: 5 test files, the doc, `helio-mcp/src/tools/write.ts` (a description string only) and change artifacts.
- `git diff --name-only ... | grep -i migration` returned nothing. The diff has **no migration**.
- I listed PR #986's files with `gh pr view 986 --json files`. The only shared file is `docs/compute-expression-grammar.md`. This branch edits it only at lines 352-375, inside "### Known limitation: a timestamp-typed column that carries a number" (L347-378). #986's hunks start at L262 and L315 (`gh pr diff 986`), so the two do not overlap. `AnalyzeSchemaWarnings.scala` and `openspec/specs/pipeline-analyze-schema-warnings/spec.md` are untouched; that spec changes only through this change's delta. **C1 holds.**
- `git merge-tree --write-tree HEAD origin/main` merges cleanly against current main `67cf9e0e0` (HEL-1523). HEL-1523 rewrites the create-path cross-owner check through `StepReferenceChecks.secondarySourceOwnershipF`. That check still uses `findByIdOwned` for join/union/lookup, so the `findByIdInternal` prefetch in `PipelineCreateTransaction` still runs only after ownership is enforced.

**AC trace.**
1. Every analyze path now covers union. `secondarySourceIdOf` drives the prefetch set in `resolveSecondarySourceSchemas`. `sourceDependencyOf` drives the projection lookup at `PipelineAnalyzeService.scala:315`. Both now include `union`. I grepped the callers of `resolveSecondarySourceSchemas` and found exactly five: `PipelineAnalyzeReads:80/215`, `PipelineNodeReads:210`, `PipelineProposalAnalyze:62` (caller-scoped `findByIdOwned`) and `PipelineCreateTransaction:74`. Access policy matches run time: `UnionStep.scala:96` resolves through `findByIdInternal` too.
2. Projection, the collision error and `canRun:false`/`step-config-invalid` are covered by `PipelineAnalyzeUnionSourceSpec`. That spec runs against a real embedded Postgres with real `DatasetSource` rows, through the analyze, capabilities (child step), proposal and create paths.
3. The degraded passthrough is covered three ways: a source with no inferred schema (seam spec), an empty `dataSourceId` and a source absent from the map (`PipelineAnalyzeServiceSpec`), and the GUARD in `TimestampNumberParitySpec`.
4. The `AnalyzeSchemaWarnings` change is pinned by a test, not assumed (see the mutation results below).
5. The KNOWN GAP guard is flipped, the doc section is updated and the three spec deltas are written. Comparing scenario headers per requirement between the canonical specs and the deltas shows additions only. No scenario was dropped.
6. No run-time file changed, and there is no migration.

**Fresh gates (my own runs).** I ran these in a scratch export of `c957a1eaf` (`git archive`, fresh compile), with `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g`, in the foreground, each under 600 s:
- HEAD, 4 changed specs (`TimestampNumberParitySpec`, `PipelineAnalyzeServiceSpec`, `AnalyzeSchemaWarningsSpec`, `PipelineAnalyzeUnionSourceSpec`): `Tests: succeeded 250, failed 0`. All new test names appear in the log.
- HEAD, `testOnly com.helio.api.routes.pipelines.* com.helio.domain.steps.* com.helio.api.protocols.pipelines.*`: `Tests: succeeded 1433, failed 0`. This includes `PipelineAnalyzeRoutesSpec`.
- HEAD, `testOnly com.helio.services.pipelines.* com.helio.services.patchsets.*`: `Tests: succeeded 876, failed 0, canceled 1`. The cancel is the `HELIO_MEASURE`-gated measurement spec.
- I did not run `domain.engine.*` as a whole. The evaluator pasted it as 1110/1110, and the 3 engine specs this change touches are in my run above.

**Red-on-base and mutation evidence (independent, not taken from the evaluator).**
- **Base logic.** I replaced `PipelineAnalyzeService.scala` with the version at `37311542a` and ran the same 4 specs: `succeeded 240, failed 10`. All 10 new non-guard tests failed: 5 seam, 2 parity, 1 warnings and 2 projection/id-function. All guards stayed green.
  - `ACCEPT an Output mapping` failed with `Left(BadRequest("fieldMapping references column(s) not present at this node: extra. Available columns: id"))`. That is exactly the stated widening.
  - The capabilities test failed with `Vector("id") was not equal to Vector("id", "extra")`.
- **M-proj.** At HEAD with `union` removed from `sourceDependencyOf` only: again `failed 10`. `AnalyzeSchemaWarningsSpec.scala:188` fails with a false `field-not-in-input-schema` on `only_in_secondary`. This confirms the test's comment that the first assertion catches M-proj.
- **Cleanup.** I restored the file, confirmed it with `cmp` against `c957a1eaf`, and deleted the scratch copy. No file in WORKTREE_PATH was modified.

The red evidence is real: each failure message names the exact behaviour the AC changes.

**UI.** No `frontend/**` file changed. Step 4 (visual judgment) does not apply, so I did not start servers.

**Honesty of claims.** The proposal and design.md state the widening of Output `fieldMapping` and the visible changes to existing source unions (extra columns, possible step error, new downstream warnings) plainly for the owner. The `tasks.md` "Task results" claims match the five call sites I found by grep.

### Verdict: CONFIRM

### Non-blocking notes
- In the `pipeline-union-op` delta, the scenario titled "A source-kind secondary is not checked" is only accurate because its WHEN clause says "cannot resolve". It would read better as "An unresolved source-kind secondary is not checked". This is cosmetic, and the evaluator raised it too.
- `files-modified.md` lists `tasks.md` twice. Merge the two lines.
- `sourceDependencyOf` and `secondarySourceIdOf` must stay in sync for union. The M-proj run shows that dropping union from only one produces false `field-not-in-input-schema` warnings. `PipelineAnalyzeServiceSpec`'s id-function test pins both, which is adequate.
- When #986 or this PR merges second, re-check the archived `pipeline-analyze-schema-warnings` MODIFIED block against the rebased canonical spec, as design.md already notes.
