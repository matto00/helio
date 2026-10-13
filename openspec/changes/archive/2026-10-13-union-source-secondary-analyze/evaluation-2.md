## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `c957a1eaf052a5c6beeb5a74b435ed62a42826bd`. Diff base (resolved live): `37311542aed346150f7eceda407be1560265f546`. The cycle-2 delta is `3635893ae..c957a1eaf`, and I re-read the full branch diff where the delta needed context.
I did not judge the assumed product call. It stays parked for owner review.

### Phase 1: Spec Review — PASS

Cycle 1 Change Request 1 (stale comments) is resolved:
- `backend/src/main/scala/com/helio/domain/engine/MultiInputSchemaInference.scala:12-18`: the lookup doc now says `sourceDependencyOf` deliberately excludes `lookup`, unlike `join`/`union`. The false phrases "identity-passthrough" and "same limitation `union` already documents" are gone.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala:146-152`: the comment now ties the passthrough to the harness supplying no `ds-2` entry.
- A fresh grep for `union ... passthrough|unresolved|known gap` in `backend/src/main` returns no hits.

Cycle 1 Change Request 2 (record the results of tasks 1.2-1.4) is resolved by the new `## Task results` section in `tasks.md`. I checked its claims:
- 1.2: I grepped `analyzeNodes(` in `backend/src/main`. The live call sites are exactly `PipelineAnalyzeReads.scala:115/232`, `PipelineNodeReads.scala:224`, `PipelineProposalAnalyze.scala:84` and `PipelineCreateTransaction.scala:75`. Each takes `secondarySchemas` from `resolveSecondarySourceSchemas` at the cited preceding line. The only other hit is the two-argument overload delegating at `PipelineAnalyzeService.scala:284`, and no main-code caller uses it. The record matches.
- 1.3: matches my own cycle-1 finding.
- 1.4: the dispositions match the tree.

All ACs, the spec deltas and C1 are as recorded in evaluation-1.md. The cycle-2 delta touches no PR #986 file: it changes `MultiInputSchemaInference.scala`, `PipelineAnalyzeServiceSpec.scala`, `PipelineAnalyzeUnionSourceSpec.scala`, `tasks.md`, `files-modified.md` and `evaluation-1.md`.

Issues: none blocking.

### Phase 2: Code Review — PASS

Gates were run by me. The backend shards ran in a throwaway worktree detached at `c957a1eaf`, with a one-line comment cache-buster in 2 test files. Each log shows `compiling 624 Scala sources ... test-classes` and a real `Run completed`. I removed the worktree afterwards (`git worktree list` shows 0 entries for it). Each shard ran with `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g`, with forked test-group concurrency at the local default of 1:

| Shard | Result |
|---|---|
| `testOnly com.helio.domain.engine.*` | 1110 tests: succeeded 1110, failed 0 (hel1468-guard failed=0 aborted=0) |
| `testOnly com.helio.services.pipelines.*` | 612 tests: succeeded 612, failed 0, canceled 1. The canceled one is `OutputFilteredMetricMeasurementSpec`, gated on `HELIO_MEASURE=1`. All 7 `PipelineAnalyzeUnionSourceSpec` tests passed, including the new child-step capabilities test and the `canRun`/`step-config-invalid` assertions. |

Cycle 2 changed only comments in main code and only seam tests. The `api.routes.pipelines`, patchsets, assistant and protocols shards were green in cycle 1 on identical main logic, so I did not re-run them. I did not run the whole `sbt testFull` because it exceeds the 600 s foreground limit.

**Mutation re-check for the reworked seam tests.** I deleted the `union` arm of `secondarySourceIdOf` (M-ids) and ran `PipelineAnalyzeUnionSourceSpec`: 5 failed and 2 passed. The failures are analyze projection, analyze collision, the capabilities test (now on the child step), proposal and create-accept. The 2 that passed are the GUARD tests (passthrough and still-reject). I restored the mutation before removing the worktree. The new `canRun == false` assertion sits after the `validationError` assertion in the same test, so this mutation does not exercise it on its own. It is additive coverage of the AC2 surfacing and needs no separate red proof.

Other gates, run in `WORKTREE_PATH`: `npm run check:scala-quality`, `check:openspec`, `check:spec-structure`, `lint` and `format:check` all exit 0.

Code checklist: no new code smells. The capabilities test now builds a real child `select` step with `parentStepId = unionId`, which matches task 2.6. The mutation metadata was moved out of the test names, as cycle 1 suggested.

### Phase 3: UI Review — N/A

No UI trigger matched. Nothing under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or the canonical `openspec/specs/**` changed.

### Overall: PASS

### Non-blocking Suggestions
- `openspec/changes/union-source-secondary-analyze/files-modified.md` now lists `tasks.md` twice: "tasks ticked" and "added ## Task results". Merge them into one line.
- The cycle-1 suggestion to rename the delta scenario "A source-kind secondary is not checked" to "An unresolved source-kind secondary is not checked" is still open. It is cosmetic.
