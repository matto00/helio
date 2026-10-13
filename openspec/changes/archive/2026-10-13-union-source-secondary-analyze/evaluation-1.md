## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `3635893ae5635da82542eec4a8648fa06a9c60f5`. Diff base (resolved live): `37311542aed346150f7eceda407be1560265f546`.
I did not judge the assumed product call (resolve a source-kind union secondary's schema in analyze). It is parked for owner review. I judged only the implementation against ticket.md's ACs, the spec deltas, tasks.md and C1.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1: every analyze path resolves a source-kind union secondary | PASS. I grepped all 5 `analyzeNodes(` call sites: `PipelineAnalyzeReads.scala:80/215`, `PipelineNodeReads.scala:210`, `PipelineProposalAnalyze.scala:62` and `PipelineCreateTransaction.scala:74`. Each one passes a map built by `resolveSecondarySourceSchemas`, and that map's id set now includes `union` through `secondarySourceIdOf`. The seam spec exercises the analyze, capabilities, proposal and create paths. |
| AC2: union projects parent fields then secondary-only fields; the collision check fires | PASS. Covered by unit tests and the seam spec (`PipelineAnalyzeUnionSourceSpec`). |
| AC3: a missing, empty-id or schema-less source passes through | PASS. Empty id: `PipelineAnalyzeServiceSpec`. Absent from the map: `TimestampNumberParitySpec` GUARD and `PipelineAnalyzeServiceSpec`. No inferred schema: the seam spec. `resolveSecondarySourceSchemas` drops an empty schema (`PipelineServiceSupport.scala:106`), so a schema-less source never becomes name-complete. |
| AC4: the `AnalyzeSchemaWarnings` change is verified by a test | PASS. New `AnalyzeSchemaWarningsSpec` case. It goes red under both mutations (verified below). |
| AC5: KNOWN GAP guard, `pipeline-union-op` delta and the doc section are updated | PASS |
| AC6: no run-time change, no migration, no edits to #986 files except the doc section | PASS (see C1) |
| Task items all done and matching the implementation | **FAIL**. See Change Requests 1 and 2. |
| No scope creep | PASS |
| No regressions | PASS. Gate shards are green (see Phase 2). |
| API contracts | PASS. No shape change. |
| Planning artifacts reflect the implementation | PASS. The `pipeline-analyze-schema-warnings` delta repeats the canonical "Missing referenced field warns" text verbatim and adds one scenario. #986 does not touch that requirement (I checked `gh pr diff 986`). |
| CONSTRAINTS C1 honoured | PASS. `gh pr view 986` lists 32 files. The only one this diff shares is `docs/compute-expression-grammar.md`, and the hunks are confined to the "Known limitation: a timestamp-typed column that carries a number" section (L352-375). `AnalyzeSchemaWarnings.scala` is not edited. The red-on-mutation half of C1 is verified below. |

Issues:

1. **Task 1.4 is ticked but incomplete.** The sweep missed two statements that this change makes false. One is two lines above a hunk the commit already edited.
   - `backend/src/main/scala/com/helio/domain/engine/MultiInputSchemaInference.scala:14-16` (the `lookup` doc comment) says "identity-passthrough group `join`/`union` belong to. The reference source's schema isn't resolvable at this layer (no repo access, same limitation `union` already documents)". Union no longer documents that limitation. As of this change its source schema is supplied by the caller (as join's already was), and the union doc comment at L54-65 now says so.
   - `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala:146-150` (the HEL-384 union test comment) says "The other source's schema isn't resolved at analyze time, so the output schema is exactly the input schema unchanged". That is now true only because this test's `analyze` helper supplies no secondary map.
2. **Tasks 1.2, 1.3 and 1.4 say "record the result" / "record every hit and its disposition".** No artifact records them: not `files-modified.md`, not `tasks.md`, not the commit body. I re-derived 1.2 (5 call sites, all prefetch) and 1.3 (no client-side union projection; `stepNarrowing.ts:751` "passthrough" refers to config widening, not schema). The record still belongs in the change dir.

### Phase 2: Code Review — PASS (gates); code findings are the Phase 1 items above

All gates were run by me. The backend shards ran in a throwaway worktree detached at `3635893ae`, with a one-line comment cache-buster in two test files so sbt 2 could not replay a cached result. Each log shows `compiling ... test-classes` and a real `Run completed`. I removed the worktree afterwards (`git worktree list` shows 0 entries for it). Each shard ran with `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g`, the project path was checked, and forked test-group concurrency was the local default of 1:

| Shard | Result |
|---|---|
| `testOnly com.helio.domain.engine.*` | 38 suites, 1110 tests: succeeded 1110, failed 0 (hel1468-guard failed=0 aborted=0) |
| `testOnly com.helio.services.pipelines.*` | 79 suites, 612 tests: succeeded 612, failed 0, canceled 1. The canceled one is `OutputFilteredMetricMeasurementSpec`, gated on `HELIO_MEASURE=1`, so the cancel is expected. All 7 `PipelineAnalyzeUnionSourceSpec` tests ran and passed. |
| `testOnly com.helio.api.routes.pipelines.*` | 44 suites, 655 tests: succeeded 655, failed 0 |
| `testOnly com.helio.services.patchsets.* com.helio.services.assistant.* com.helio.api.protocols.pipelines.*` | 42 suites, 467 tests: succeeded 467, failed 0 |

I did **not** run the whole `sbt testFull`. It exceeds the 600 s foreground limit. Only the 4 shards above ran, covering the engine, pipeline service, pipeline route, patch-set, assistant and pipeline-protocol packages.

**Mutation verification.** I applied each mutation in the throwaway worktree and ran 4 specs: `TimestampNumberParitySpec`, `PipelineAnalyzeServiceSpec`, `AnalyzeSchemaWarningsSpec` and `PipelineAnalyzeUnionSourceSpec`. The executor's claims held.
- **M-proj** (deleted the `union` arm of `sourceDependencyOf`): 10 failed out of 250. The failures cover every new HEL-1520 assertion: 2 in `PipelineAnalyzeServiceSpec` (projection, id-function), 2 in `TimestampNumberParitySpec` (collision, reverse), 1 in `AnalyzeSchemaWarningsSpec` (name-complete) and 5 seam tests (analyze projection, analyze collision, capabilities, proposal, create-accept).
- **M-ids** (deleted the `union` arm of `secondarySourceIdOf`): 7 failed out of 250: the id-function test, the 5 seam tests and the `AnalyzeSchemaWarningsSpec` name-complete test. The pure `analyzeNodes` unit tests stay green under M-ids, which is expected because they supply the map directly. This matches the comments in the specs.
- The base commit amounts to M-proj plus M-ids, so every new non-GUARD assertion is red on base.
- The tests labelled GUARD are the passthrough and "still REJECT" cases. They pass on base by design, and their labels say so.

Other gates, run in `WORKTREE_PATH`:
- `npm run lint`, `npm run format:check`, `npm run check:scala-quality`, `check:openspec`, `check:spec-structure`, `check:helio-mcp-types`, `check:test-temp-dir-hygiene`, `check:no-credential-leak`: all exit 0.
- `npx prettier --check` on the changed md/ts files and `npx eslint --max-warnings=0 helio-mcp/src/tools/write.ts`: clean.
- helio-mcp `tsc --noEmit -p tsconfig.typecheck.json`: exit 0.
- `npx jest helio-mcp` (3 workers): 48 suites, 450 tests, all pass.
- No `frontend/**` files changed, so the frontend build and the full `npm test` were not required.

Code checklist:
- **DRY:** `sourceDependencyOf` now has the same `Try(op match ...)` shape as `secondarySourceIdOf`. Two near-identical functions remain, but design Decision 1 accepted that deliberately so that `lookup` stays out of the projection. Acceptable.
- **Readable / modular / type safety:** fine. No escape hatches.
- **Security:** fine. The proposal path keeps `findByIdOwned`, and the seam test proves a foreign tenant's source is not projected (it gets the passthrough). Persisted paths use `findByIdInternal` under the pipeline ACL, same as join.
- **Error handling:** fine. Tolerant decode, and an empty schema is filtered out.
- **Tests are meaningful:** yes, verified by mutation above.
- **No dead code:** fine.
- **Comment accuracy:** two stale comments, see Change Request 1.

### Phase 3: UI Review — N/A

No trigger matched: nothing under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or the canonical `openspec/specs/**` changed (the deltas live under `openspec/changes/`). The behaviour change does reach the UI, though: extra columns appear in downstream pickers, and a union step card can now show an error. Both use existing generic rendering. That visible change is part of the owner-review item, not a mechanical UI regression.

### Overall: FAIL

### Change Requests
1. **Fix the two stale comments that the task 1.4 sweep missed.**
   - In `backend/src/main/scala/com/helio/domain/engine/MultiInputSchemaInference.scala:14-16`, stop calling `join`/`union` an "identity-passthrough group" and drop "same limitation `union` already documents". State instead that `lookup` keeps placeholder `string` types for a source secondary because `sourceDependencyOf` deliberately excludes it, unlike join and union.
   - In `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala:146-150`, reword the comment to say the passthrough holds because this harness supplies no `secondarySourceSchemas` entry for `ds-2` (an unresolved source). Do not say the source is never resolved at analyze time.
2. **Record the results that tasks 1.2, 1.3 and 1.4 require**, in `files-modified.md` or under the tasks in `tasks.md`:
   - 1.2: the 5 `analyzeNodes(` call sites and that each one prefetches.
   - 1.3: no client-side union projection in `frontend/src` or `helio-mcp/src`.
   - 1.4: every sweep hit and what was done with it, including the two items above.

### Non-blocking Suggestions
- AC2 also says the collision surfaces as `step-config-invalid` with `canRun: false`. The seam test checks `validationError` but not the `canRun`/reason on a source union. A single assertion on `costVerdict.canRun == false` in the existing seam collision test would close that link.
- `PipelineAnalyzeUnionSourceSpec`'s capabilities test is described in the tasks as "a step below a source union", but it queries `stepId` = the union step itself. Either rename the test or add a child step and query that.
- Test names in `PipelineAnalyzeUnionSourceSpec` carry "(red under M-ids / M-proj)". That is mutation metadata, not intent, and fits better in the existing class doc comment (CONTRIBUTING "The test name carries the intent").
- The `pipeline-union-op` delta keeps the scenario title "A source-kind secondary is not checked" while its WHEN clause now restricts it to an unresolved source. Consider "An unresolved source-kind secondary is not checked".
