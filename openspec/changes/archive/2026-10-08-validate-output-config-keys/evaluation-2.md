## Evaluation Report — Cycle 2 (evaluation-2.md)

- **Reviewed HEAD:** `62720db1bbb4c5c81e4075a71fad9e8403655ab6`.
- **Base:** `55b7c4269d90eea7f3c71f3a2e3857a4018ee47b`, resolved live with resolve-review-base.sh.
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/output-config-key-validation/hel-1313`.
- **Files changed since cycle 1** (`git diff --name-only 420524f8a..HEAD`):
  - `helio-mcp/src/tools/combinedProposal.ts`
  - `helio-mcp/src/tools/pipelineProposal.ts`
  - `openspec/changes/validate-output-config-keys/specs/output-routes-api/spec.md`
  - `openspec/changes/validate-output-config-keys/evaluation-1.md`

### Gates (fresh, in WORKTREE_PATH)

| Gate | Result |
|---|---|
| `npm run lint` | clean |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npm --prefix helio-mcp run typecheck` | clean |
| root jest (helio-mcp + scripts), maxWorkers=3 | 42 suites / **401** tests passed. This is the same count as cycle 1, so no test was added. |
| `openspec validate … --type change` / `check-openspec-hygiene.mjs` | valid / clean |
| backend `sbt testFull`, frontend jest, frontend build | **Not re-run.** The `420524f8a..HEAD` diff touches no `backend/**`, `frontend/**` or `schemas/**` file. My cycle-1 runs at `420524f8a` therefore still describe these files exactly: 6150 passed / 0 failed for the backend, 4903 passed for frontend jest, and the build succeeded. This is shown by the content diff above, not by file timestamps. |

### Phase 1: Spec Review — FAIL

- **CR1, code half: done.**
  - `OUTPUT_CONFIG_KEYS_DOC` is now appended to:
    - `analyze_pipeline_proposal` (`pipelineProposal.ts` L172-173)
    - `apply_pipeline_proposal` (L202-203)
    - `apply_combined_proposal` (`combinedProposal.ts` L95-97, with the import added)
  - Every helio-mcp tool that carries Output config now documents the key set, which meets the `mcp-output-tools` requirement.
- **CR1, test half: NOT done.**
  - Cycle 1 asked for `"analyze_pipeline_proposal"`, `"apply_pipeline_proposal"` and `"apply_combined_proposal"` to be added to the HEL-1313 `it.each` in `helio-mcp/src/server.test.ts`, so that dropping the doc would make a test fail.
  - `server.test.ts` is unchanged in `62720db1b`: `git log -- helio-mcp/src/server.test.ts` shows `420524f8a` as the last commit.
  - The `it.each` at L292-298 still lists only `add_output`, `update_output`, `create_pipeline`, `propose_pipeline` and `apply_patch_set`.
  - The root jest count also stayed at 401.
  - The cycle-2 handoff said this test change had been made. It has not.
  - As a result, the three new doc placements are not covered by any test: deleting any of them leaves every test green.
- **Suggestion taken:** the spec scatter wording now reads "changes either key from its stored value". This matches D3 and the implementation (`OutputConfigValidation.scala` L107-112).
- Every other Phase 1 item is unchanged from evaluation-1 (all ACs PASS).

### Phase 2: Code Review — PASS

- The three description additions follow the existing pattern (a single source constant) and are lint/format/tsc clean.
- No other code changed.

### Phase 3: UI Review — N/A this cycle

- No UI-trigger files changed since cycle 1. The changed files are only helio-mcp tool descriptions and an openspec delta.
- The Phase 3 result from evaluation-1 (PASS at `420524f8a`) still holds unchanged.
- I created no new dev-DB records this cycle. The cycle-1 records listed in evaluation-1 remain.

### Overall: FAIL

### Change Requests
1. **`helio-mcp/src/server.test.ts` L292-298:** add `"analyze_pipeline_proposal"`, `"apply_pipeline_proposal"` and `"apply_combined_proposal"` to the HEL-1313 `it.each([...])` list.
   - This was part of cycle-1 CR1 and was not done.
   - Run root jest afterwards and confirm the count rises from 401 to 404.
   - Then make sure the test can actually fail: temporarily remove `OUTPUT_CONFIG_KEYS_DOC` from one of the three descriptions, confirm that case fails, and restore it.
   - `listRegisteredTools()` goes through `createServer`, which registers both `registerPipelineProposalTools` and `registerCombinedProposalTools` (`server.ts` L34-35). All three tools are therefore visible to the test.

### Non-blocking Suggestions
- These cycle-1 suggestions are still open:
  - the no-op `doc shouldBe a[String]` in `AssistantProposalToolSchemasSpec`
  - the long chained line at `PipelineService.scala` L681
  - the re-wrap of the `PatchSetPreviewProjection.scala` L125 comment
  - the design.md "both prompts" wording

### Critical Path (cycle 2 of 3)
- The only remaining blocker is CR1 above: three strings added to one test list, plus the mutation check.
- Everything else has been verified green with fresh runs at this HEAD or at the content-identical cycle-1 SHA.
- Recommendation: give the executor this one specific CR. Have it report the before/after jest count (401 → 404) and the mutation-red output, so cycle 3 can confirm both.
