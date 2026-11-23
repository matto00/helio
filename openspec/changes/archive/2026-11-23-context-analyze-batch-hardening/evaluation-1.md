## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `76f51325c90254abd882bb5dccaa4f931f1266eb` against the live-resolved base `1cdd7df9084fe812729ea4731f1eda502b94fd98`
(commits 0929e2fd6, 2493ace64, 76f51325c).

### Phase 1: Spec Review — FAIL

- AC item 1 (raw source-id lookup, a test fails first): PASS. Red committed alone in 0929e2fd6 before the fix in 2493ace64.
  I reproduced it: with only `PipelineContextAnalyzeReads.scala` reverted to base, `PipelineContextAnalyzeRoutesSpec` fails
  1 of 7. The three upper-case cases show a batch/analyze diff, and the three non-UUID cases are "omitted from the batch".
  This matches `red-backend-raw-id.txt`. The join and lookup secondaries name `ref`, which is seeded with `RefSchema`, so the
  case is not vacuous (skeptic note 3). The extraction helpers (`secondarySourceIdOf`, `targetIdsOf`) do no trimming, so the
  prefetched raw ids are exactly the ids the resolver is asked for. `Future.fromTry(Try(...))` is kept (skeptic note 1).
  Comments are corrected (D2).
- AC item 2 (missing `steps` falls back, test fails first, goldens unchanged): the `fetchContextAnalyze` change is correct and
  `git diff 1cdd7df90 HEAD -- helio-mcp/src/__golden__` is empty. The red is adequate, as analysed below. **However**, the same
  filter was also added to `fetchContextDetails` (`helio-mcp/src/context.ts:263-271`). That is outside design D3 (which names
  only `fetchContextAnalyze`), outside the ticket, outside both spec deltas, and not listed in tasks. See Change Request 1.
- AC item 3 (N+1 mutation red committed): PASS. `red-n-plus-one-mutation.txt` shows the full
  `PipelineContextAnalyzeQueryCountSpec` failing with `(5, 203) was not equal to (5, 13)`, which is one privileged statement per
  pipeline (a genuine N+1). The mutation code is not in the diff. Its current green run is part of my 39/39 run below.
- Tasks: all checked, and they match the work except for the unlisted `fetchContextDetails` change.
- API/schema: no change, as intended. Constraints in `workflow-state.md`: `[]`.

**Red-evidence deviation (MCP).** `red-mcp-missing-steps.txt` was committed in 76f51325c together with the fix, because the
pre-commit jest hook refuses a red tree. Under lane rule C12 this is acceptable *if the PR says so*. The commit message already
says so, and the PR body must repeat it. I checked the evidence independently: with only `helio-mcp/src/context.ts` reverted to
base (file restored afterwards, worktree clean), `contextRequestBudget.test.ts` fails exactly the three new cases (3 failed,
40 passed). That includes `omitted 1 of 55` received where `/omitted 2 of 55/` was expected, the same output as the committed
.txt. I judge the evidence genuine and adequate.

### Phase 2: Code Review — FAIL

Gates I re-ran myself, in `WORKTREE_PATH`:
- helio-mcp jest, full suite (3 workers): 69 suites, 626 tests, all pass.
- `helio-mcp` typecheck: pass. `npm run check:helio-mcp-types`: pass.
- eslint `--max-warnings=0` on both changed TS files: pass. prettier `--check` on the changed TS and change-dir markdown: pass.
- `sbt -J-Xmx3g testOnly` of `PipelineContextAnalyzeRoutesSpec`, `PipelineContextAnalyzeQueryCountSpec`,
  `PipelineContextAnalyzeUndecodableRowSpec`, `PipelineAnalyzeRoutesSpec` and `PipelineAnalyzeUpsertGranteeGuardSpec`
  (lane DB environment, empty API key): 39 succeeded, 0 failed.
- `npm run check:scala-quality`: clean (pre-existing soft warnings only).

Issues:
1. **Untested, unspecified behavior change in `fetchContextDetails`** (`helio-mcp/src/context.ts:263-271`). A steps-less
   context-details item is now treated as absent. Before, `detail` was set and `laneTree` degraded to `[]` through its catch,
   with `lastRunAssertions` taken from the item. Now the pipeline falls back to per-pipeline `/steps` and `/run-history` reads,
   and the context-details stderr line counts it. Mutation probe: I deleted only this `.filter(...)` line and ran the full
   helio-mcp suite. All 626 tests still pass, so no test covers it. There was no red-first run, and no spec delta covers it.
2. **Wrong comment on the copied block** (`helio-mcp/src/context.ts:266-267`). It says the pipeline "is analyzed per pipeline
   ... instead of failing inside the step mapping". On the details path nothing is analyzed: the fallback is the steps and
   run-history reads, and the counted line is the context-details one.
3. DRY (minor, follows from 1): the same five-line filter-plus-comment block appears twice. If the details change is kept, put
   it in one helper.

No issues in the backend diff: raw-id prefetch, `map.get(raw)`, no `UUID` import, comments accurate. The test collects every
case's diff before asserting, which is a good diagnostic. The new class-level `rootIds` mutable map is small test-local state
and acceptable.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change. The change-dir spec deltas are not the
`openspec/specs/**` trigger, and the change has no UI surface.

### Overall: FAIL

### Change Requests
1. `helio-mcp/src/context.ts:263-271`: revert `fetchContextDetails` to base (`return new Map(response.items.map((item) =>
   [item.pipelineId, item]));`). This keeps the change to D3, which touches only `fetchContextAnalyze`. Alternatively, if the
   executor and orchestrator want the details hardening in this ticket: add it to design.md, tasks.md and the
   `mcp-workspace-context-request-budget` spec delta, add a red-first test (a `contextDetailsBody` that drops `steps` from one
   item, with full and concise golden equality plus a request-count and stderr assertion), commit the red, and fix the comment
   so it describes the steps and run-history fallback (Change Request 2). Reverting is the recommended path. Whichever path you
   take, the diff must not keep a behavior change that no test detects.
2. If the details filter is kept at all: rewrite the comment at `helio-mcp/src/context.ts:266-267` to name the actual fallback
   (per-pipeline `/steps` and `/run-history`, counted in the context-details "omitted N of M" line), and put the shared filter
   in one helper so it is not written out twice.

### Non-blocking Suggestions
- The PR body must state that `red-mcp-missing-steps.txt` was committed with its fix because the hook refuses a red jest tree
  (no `-n` bypass), per lane rule C12. 76f51325c's commit message already says so.
- Evaluator probe outputs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1827/eval1/`: `mcp-red-repro.txt`,
  `mcp-details-mutation.txt`, `be-red-repro.txt`, `be-green-ctx.txt` and `mcp-green.txt`.
