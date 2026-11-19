## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `14c769c55a039d66f94e3162b73aeffae546b10e` against live-resolved base `42b0b2f3dffaa36c8c75dd46bd56aff4a9ec1c4a` (3 commits).

### Fresh gate runs (evaluator's own, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `sbt -J-Xmx3g testFull` (nice 19, FULL suite, at HEAD incl. 14c769c55) | EXIT 0 — `Tests: succeeded 9982, failed 0, canceled 5` (closes the executor's admitted gap: full testFull was not re-run after the OutputKindDriftSpec fix) |
| root `npx jest` (3 workers; helio-mcp tests live here) | 69 suites / 611 tests passed |
| `npm run lint` | 0 |
| `npm run format:check` | clean |
| `npm run check:helio-mcp-types` | 0 |
| `npm run check:scala-quality` | clean (soft warnings only) |
| `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` | Passed; no lockfile in the diff |
| grep of `outputKindSchema`, the three tool names and `"timeline", "markdown"` across `e2e/` and `helio-mcp/src` | no stale reference; no re-inlined kind enum outside `outputKinds.ts` |

No `frontend/**` change, so the frontend build gate does not apply.

### Phase 1: Spec Review — FAIL

- ACs: tools, kind enums, docs, place_outputs test, audit-ci all addressed. The "exit criterion... gets a cited narrative" AC is met in form but hollow (issue 1).
- **Issue 1 (exit criterion's narrative does not use what it reads; design D7 deviation).** D7 required the seeded world to carry "a successful run's snapshot and history points (so citations are real numbers)". `InsightSeamSpec.beforeAll` (`backend/src/test/scala/com/helio/api/protocols/InsightSeamSpec.scala:70-79`) seeds only a node snapshot (`seedRows`), no history points and no `compare` on Revenue. Per `InsightInputsBuilder.build` / `InsightInputAdapters.fromResolution`, a read Output adds to the pack only through a compare (needs a compare token and a metric current point) or a window (needs history points). So `reads.outputs: [Revenue]` adds nothing. The whole pack is the insight's own node head, and the script (`InsightSeamSpec.scala:114-117`) cites its first numeric cell. The recorded narrative is `"The headRowCount is 1.0 [c1]."` with `outputId: {{OUTPUT_INSIGHT}}` (`shared-test-fixtures/insight/exit-criterion.json`, get-insight leg). That is a row count of the insight's own node. It would be byte-identical with `reads: {outputs: []}`, so the "insight over an existing pipeline's Output" leg proves nothing about reading. Category: intent-mismatch. See CR 1.
- **Issue 2 (task 3.1 marked done but not done as written).** Task 3.1 says "see it red before 2.5 lands". The executor says the MCP exit test was written after the tools. The only red evidence is `.concertino/scratch/HEL-1747/mutation-exit-mcp.txt`, which holds just `Tests: 1 failed, 1 total` and does not say what was mutated. That is not evidence a reader can check. See CR 2.
- Scope: the `OutputKindDriftSpec` edit was unplanned, but the removed pins were literally labelled "HEL-1747 L8 owns them", so editing it is in scope and required. It is now in `files-modified.md`, but `design.md`/`tasks.md` do not mention it (Non-blocking 1).
- Regressions: none (full backend and root jest green).
- API contracts: no schema changed; the new `types.ts` interfaces match `output-insight-response`, `output-insight-refresh-response` and `ask-response`. The seam spec validates the raw bodies against those three schemas.
- CONSTRAINTS in workflow-state.md: empty. The driver constraints were honoured: no live model call (scripted transport, `hopCount shouldBe 3`), embedded Postgres only, no `.env` access.

### Phase 2: Code Review — FAIL

- Gates: all green (table above).
- DRY / single source: good. `OUTPUT_KINDS` drives every enum and the prose kind list. The jest drift test pins it to the backend schema and fails on a re-inlined literal. The backend `OutputKindDriftSpec` pins the tuple to `OutputKind.all`.
- Pass-through handlers, no reshaping: matches D2. `refresh_insight` sends no body (tested). `ask_dashboard` takes no model argument, bounds the question to 1..2000 with zod, and tests the empty and 2001-character cases with zero requests.
- `ask.ts` duplicates `jsonResult`/`guarded`. That is the existing per-tool-file convention (12 files define their own `guarded`), so not flagged.
- **Dead code:** `helio-mcp/src/tools/insightSurface.test.ts:11` imports `HARNESS_BASE_URL` only to silence it with `void HARNESS_BASE_URL;` at the last line of the file. See CR 3.
- **Tests meaningful (exit test):** the spec scenario says "each result carries the recorded body". `insightExitCriterion.test.ts` checks request equality per leg (good). For results it checks only selected fields (`kind`, `started`, citation count and markers), never that the tool result equals the recorded `response`. A tool that dropped or reshaped fields (for example `pin`, `lastAttempt`, `canRefresh`) would pass. See CR 4.
- **Stale comment in an edited file:** `OutputKindDriftSpec.scala:18-22` ("except the sites a later leaf owns") and `:116-117` ("Exclusions: surfaces a later leaf owns. They must keep the six pre-insight kinds until that leaf lands" / `"pinned exclusions (until their owning leaf)"`). After this change the two remaining exclusions (in-app `AssistantProposalToolSchemas`, `KeysDoc`) have no owning leaf: this ticket disowned them as a non-goal. The comment now asserts something false. See CR 5.
- Naming: `api2` in `InsightSeamSpec.scala:68` is opaque (Non-blocking 2).
- Type safety, security, error handling: fine. Errors surface as `isError` naming the status, and the backend is the sole validator.
- File size: `helio-mcp/src/tools/outputs.ts` grew from 379 to 446 lines, past CONTRIBUTING.md's ~400-line "propose a split in the PR description" threshold (Non-blocking 3).

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change. The diff touches only `openspec/changes/**`, helio-mcp, backend test and comment files, docs and a shared fixture.

### Overall: FAIL

### Change Requests

1. **Make the exit-criterion narrative actually read Revenue** (`backend/src/test/scala/com/helio/api/protocols/InsightSeamSpec.scala`, plus a regenerated `shared-test-fixtures/insight/exit-criterion.json`). In `beforeAll`, give Revenue a read path the insight pack consumes, as D7 specified. Either seed history points for Revenue (`AskApiHarness.addDailyPoints` / `addPoint` exist) and add `reads.windows` to the insight config in leg 1, or give Revenue a `compare` config plus metric-bearing history points so it yields an `InsightCompare`. Change the render script (`:114-117`) to cite a citation whose `outputId` is Revenue's id, not the first numeric cell. Add an assertion in the spec that at least one `render.citations[]` entry has `outputId == rev.id.value`, and the matching assertion in `insightExitCriterion.test.ts` (some narrative citation has `outputId === "id-output_revenue"`). Record a mutation for it: set the insight's `reads.outputs` to `[]` and show the spec go red. Regenerate the fixture with `HEL1747_WRITE_FIXTURE=1` and keep the call-count assertion at 3.
2. **Give task 3.1 real, legible red evidence, or record the deviation truthfully.** Preferred: re-run `insightExitCriterion.test.ts` against a tree without the three tools, then save that run to `.concertino/scratch/HEL-1747/red-exit-mcp-pre-tools.txt` with a header naming the mutation. For example, with `registerAskTools(server, api)` and the `get_output_insight`/`refresh_insight` registrations removed, which equals the pre-2.5 tree. Also rewrite `mutation-exit-mcp.txt` (or add a sibling file) to state exactly what was mutated. If that is not done, change task 3.1's text in `tasks.md` to say the red came from mutation after 2.5, not before it.
3. **Remove the dead import** in `helio-mcp/src/tools/insightSurface.test.ts`: drop `HARNESS_BASE_URL` from the import at line 11 and delete the trailing `void HARNESS_BASE_URL;`.
4. **Assert pass-through in the exit test** (`helio-mcp/src/insightExitCriterion.test.ts`). After each `call(...)`, assert the parsed tool result `toEqual` the matching leg's `response` (for example `expect(read).toEqual(leg("get-insight").response)`; same for add, refresh, place, ask and pin). Then the test actually proves the spec scenario "each result carries the recorded body".
5. **Fix the stale exclusion comments** in `backend/src/test/scala/com/helio/domain/model/OutputKindDriftSpec.scala:18-22` and `:116-117`. Say the remaining exclusions are the in-app assistant's surfaces, kept deliberately (HEL-1747 non-goal) with no owning leaf scheduled, instead of "a later leaf owns ... until that leaf lands". Rename the `"pinned exclusions (until their owning leaf)"` block to match.

### Non-blocking Suggestions

1. Add a line to `design.md` (Decisions or Planner Notes) recording the `OutputKindDriftSpec` change: the L8-owned helio-mcp pins were replaced by a positive check on `OUTPUT_KINDS`. This keeps the planning artifacts in step with the shipped diff.
2. Rename `api2` in `InsightSeamSpec.scala:68` (for example `scriptedApi`).
3. `helio-mcp/src/tools/outputs.ts` is now 446 lines. Per CONTRIBUTING.md, the PR description should propose a split (for example moving the insight tools and docs into `tools/insightOutputs.ts`).
4. The in-app assistant's insight exclusion (`AssistantProposalToolSchemas`, `KeysDoc`) was originally assigned to L8 by HEL-1740's drift spec, and this ticket declines it as a non-goal. The orchestrator should file a follow-up ticket so the exclusion has an owner.
