## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `d4556de5260b2cd4ef508b449d238e581760c393` against live-resolved base `42b0b2f3dffaa36c8c75dd46bd56aff4a9ec1c4a`. The new commit is d4556de52, which addresses evaluation-1.md.

### Fresh gate runs (my own runs, in WORKTREE_PATH, at d4556de52)

| Gate | Result |
| --- | --- |
| `sbt -J-Xmx3g testFull` (nice 19, full suite) | EXIT 0, `Tests: succeeded 9982, failed 0, canceled 5`; InsightSeamSpec ran and passed |
| root `npx jest` (3 workers) | 69 suites / 611 tests passed |
| `npm run lint` / `npm run format:check` / `npm run check:helio-mcp-types` / `npm run check:scala-quality` | all clean |
| `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` | Passed; no lockfile in the diff |

### Cycle-1 change requests, verified against the tree

1. **The narrative now reads Revenue. Resolved.** `InsightSeamSpec.beforeAll` makes Revenue a metric with `compare: previous_run` and two history points (100, 120). The render script now picks Revenue's `.current` citation and errors if there is none. The spec asserts that `render.citations` contains Revenue's outputId. The regenerated fixture's narrative is `"The amount.current is 120.0 [c1]."` with `outputId: {{OUTPUT_REVENUE}}`. `insightExitCriterion.test.ts` asserts that a citation has `outputId === "id-output_revenue"`.
   - **The red, as the orchestrator asked me to judge:** `red-cr1-reads-empty.txt` fails through the `eventually` timeout (no `ok` row), not through the new citation assertion.
   - I judge it a faithful proof of the property CR1 asked for: the narrative depends on what the insight reads. With `reads.outputs: []` the pack holds only the insight's own head. The scripted render then refuses (`sys.error("no Revenue citation in the pack")`), so no grounded render exists. That is the same failure an unread Revenue would produce in production terms.
   - What it does not prove on its own is the explicit `should contain(Revenue)` line. That line sits downstream of the script's own guard, so it is defence in depth rather than the load-bearing check, and its own red is not required for the property to hold.
   - Minor gap: the log excerpt does not show the `no Revenue citation` message, so the stated cause is the executor's inference. It is consistent with the code (`InsightSeamSpec.scala` script hop 0, and `readSetOf` dropping everything for an empty list).
2. **Task 3.1 is recorded truthfully. Resolved.** `tasks.md` 3.1 now names the deviation. `red-exit-mcp-pre-tools.txt` labels its mutation: `registerAskTools` and the two `registerTool` blocks removed. It shows the replay test failing on `refresh_insight` `isError: true`. `mutation-exit-mcp.txt` now states what was mutated.
3. **Dead import removed. Resolved.**
4. **Pass-through asserted. Resolved.** Every tool result in the exit test is `toEqual` to the recorded leg's `response`: add, refresh, get-insight, place, ask and pin.
5. **Drift-spec comments reworded. Resolved.** The header comment and the exclusion block name the in-app assistant surfaces as deliberate, with no owning leaf scheduled.

The cycle-1 non-blocking items were also taken up: `design.md` Planner Notes record the `OutputKindDriftSpec` deviation and the cycle-2 world, and `api2` is renamed to `scriptedApi`.

### Phase 1: Spec Review — PASS
Issues: none. All ACs are met: failing-first helio-mcp tests with labelled reds, the exit criterion scripted end to end with no live model and a narrative citing the read Output, and audit-ci green. Planning artifacts match the shipped diff. `workflow-state.md` CONSTRAINTS is empty. The driver constraints held: no `.env` reads, embedded Postgres only, scripted transport with `hopCount shouldBe 3`.

### Phase 2: Code Review — PASS
Issues: none blocking.

### Phase 3: UI Review — N/A
None of the Phase 3 trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: PASS

### Non-blocking Suggestions
- `InsightSeamSpec.scala:49`: `private var scriptedApi: Route             = _` keeps the padding sized for the old name. Re-align it with its neighbours.
- `helio-mcp/src/testing/mcpFetchHarness.ts:13`: `HARNESS_BASE_URL` is still exported but now has no importer. Un-export it, or leave it as harness API.
- `helio-mcp/src/tools/outputs.ts` is 446 lines. Per CONTRIBUTING.md, the PR description should propose a split, for example `tools/insightOutputs.ts`.
- Follow-up ticket for the in-app assistant's insight exclusion (`AssistantProposalToolSchemas`, `KeysDoc`) so it gets an owner.
- `evaluation-1.md` was committed into the change dir. That is harmless and is archived with the change.
