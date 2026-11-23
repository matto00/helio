## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c1bd77b99dabaed0c05a8e7adeb40886f7000a3e`. Diff base resolved live with `resolve-review-base.sh`: `1cdd7df9084fe812729ea4731f1eda502b94fd98` (origin/main). Spawn-cwd guard printed `READY`.

### What I verified (with evidence)

**Item 1: raw source-id lookup (backend)**
- Code: `PipelineContextAnalyzeReads.scala` no longer uses `UUID.fromString`. `rawIds` passes ids through unchanged and the resolver is `Future.fromTry(Try(map.get(raw)))`. `data_sources.id` is `TEXT` (V4__data_sources_and_types.sql:2). `findByIdsOwned` and `findByIdsInternal` both use `inSet` over strings, so a malformed id is a safe bound parameter that matches nothing. That is the same as `/analyze`'s `findByIdInternal` (`_.id === id.value`). The comment on `findByIdsOwned` that said the column "compares as uuid" is corrected.
- Red-first: commit 0929e2fd6 contains only the spec, the OpenSpec artifacts and `red-backend-raw-id.txt`, with no main-code change.
- I reproduced the red myself. I reverted `PipelineContextAnalyzeReads.scala` to the base and ran `testOnly PipelineContextAnalyzeRoutesSpec` on the lane DB. Result: `succeeded 6, failed 1`. Three upper-case cases show a steps/warnings mismatch against `/analyze`, and three non-UUID cases show "omitted from the batch". This matches the committed evidence. I restored the file and the tree is clean (scratch: `.concertino/scratch/HEL-1827/skeptic-red-backend.txt`).
- Green at HEAD: `testOnly PipelineContextAnalyze* *PipelineAnalyzeRoutesSpec *DataSourceRepositorySpec` ran 5 suites with `89 succeeded, 0 failed`. This covers the routes, query-count and undecodable-row specs (scratch: `skeptic-green-backend.txt`).

**Item 2: missing-`steps` fallback (helio-mcp)**
- Code: `fetchContextAnalyze` in `helio-mcp/src/context.ts` only maps items whose `steps` is an array. An item without one is therefore absent and falls into the existing per-pipeline path and the single "omitted N of M" stderr line. The change is null-safe through `?.`. Commit c1bd77b99 confines the change to `fetchContextAnalyze`, as D3 specifies.
- Goldens: `git diff 1cdd7df90 HEAD --stat -- helio-mcp/` lists only `context.ts` and `contextRequestBudget.test.ts`. No `__golden__` file changed.
- I reproduced the red myself. I reverted `context.ts` to the base and ran `npx jest --maxWorkers=3 helio-mcp/src/contextRequestBudget.test.ts`. Result: `3 failed, 40 passed`. Full and concise goldens mismatch, and stderr says "omitted 1 of 55" where the test expects 2. I restored the file (scratch: `skeptic-red-mcp.txt`).
- Known deviation: the red `.txt` is committed together with the fix in 76f51325c, because the pre-commit jest hook refuses a red tree. The commit message discloses this. My independent reproduction above stands in for the missing separate red commit. I accept the deviation.
- Green at HEAD: the full helio-mcp jest run has `69 suites / 626 tests passed`, `npm run typecheck` exits 0, and eslint on both changed files with `--max-warnings 0` exits 0.

**Item 3: N+1 mutation red**
- `red-n-plus-one-mutation.txt` is committed (76f51325c) and shows a real assertion failure, not a compile failure: `statements at 10 pipelines: app=5 privileged=13; at 200: app=5 privileged=203`.
- I reproduced it myself. I replaced `listByPipelineInternalBatch(idSet)` with `Future.traverse` over `listByPipelineInternal` (one query per pipeline) and ran `testOnly PipelineContextAnalyzeQueryCountSpec`. Result: `1 failed`, with identical counts of 13 vs 203 privileged statements. I restored the file, and the tree is clean apart from the orchestrator's untracked `evaluation-2.md` (scratch: `skeptic-n1-mutation.txt`).

**Spec/contract**: the deltas for `pipeline-context-analyze-read` and `mcp-workspace-context-request-budget` match the behavior I observed. No API or schema shape changed, so no `schemas/` delta was needed.

**UI**: no frontend changes, so step 4 was skipped and no servers were started.

Evidence mtimes were not relied upon. Every red was re-derived by content, through a mutation or revert I ran myself.

### Verdict: CONFIRM

### Non-blocking notes
- The spec scenario "A pipeline whose analysis cannot be produced (its projection or a source lookup) fails" is now reachable only through a projection failure. The resolver's `Try(map.get)` can no longer fail. This is harmless, but the "or a source lookup" wording is now mostly theoretical.
