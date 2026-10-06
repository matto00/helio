## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `85a90496d95ca2925f6ccde585ba41083211df53`, diff base `3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526` (resolved live with `resolve-review-base.sh`).
Scratch logs are in the session scratchpad with the `hel1345-eval-` prefix.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1/AC2: `PipelineStepRootIdPlacementRoutesSpec` covers tail append, `position` 2 / 0 / trunk length / 4 / -1, an empty root, multi-root (R2 tail and R2 `position` 1, with R1 untouched), and a root whose only root-level step has `position` 1. Every case reads the persisted tree via GET. I re-ran the red mutation (rootId arm restored to `None, explicitRootId = Some(rootId)`) in a throwaway detached worktree: 6 placement cases failed (tail, position 2, position == length, multi-root x2, position-1-only). That matches the executor's `hel1345-mut1.log` (`hel1345-eval-scratch-run2.log`).
- Lane pre-check (D3/D4): I mutated only the laneCheck anchor back to `trunkOf(current).lastOption`. Result: `201 Created was not equal to 400 Bad Request (PipelineStepRootIdPlacementRoutesSpec.scala:318)`, 9 passed and 1 failed (`hel1345-eval-scratch-run3.log`). 400 is the correct expectation: `validateLaneReference`'s cycle arm is a `BadRequest`. The test asserts its own R1-first precondition.
- AC3: I re-ran `ac3-query.sql` verbatim on embedded Postgres only (throwaway spec in the scratch worktree, never committed; no prod or shared-dev-DB access, per C9). Fixed code: legit trunk 0 rows, and two rootId appends also 0 rows. Placement mutation: legit trunk 0 rows, and root A->B plus two rootId appends gave 1 row, `trunk_len 4 | head_run_len 2 | strong 2 | weak 2 | root_count 1`. This reproduces the executor's evidence. No migration and no repair in the diff (C5).
- AC4: the scaladoc (`PipelineStepProtocol.scala`), the rootId-arm comment, the JSON Schema `position`/`rootId` descriptions, and the MCP `add_pipeline_step` description now state the real behaviour. No helio-mcp test asserts on the old text (grep: no hits).
- AC5: `applyCreatedStep` and the hook wiring apply the response delta. I independently confirmed the RTL suite is red without it (mutation below).
- `applyCreatedStep` option (b) matches design D5 and the Risks line. `chainReaches` returns false for an unresolved chain, so the reparent is applied. This is pinned by the unit test "unresolved chain (r6 note 1, option b)", and the Risks line limits the guarantee to two creates per reparented id.
- Existing-test edits are exactly the planned D5/D6 set:
  - `creatingStep` ~:238 and ~:310: `holdResync` changed to `holdCreate`;
  - `draftCreate` ~:400: retargeted to duplicate;
  - `draftCreate` item-1 reorder test: the D6 own-commit `85a90496d`;
  - `PipelineDetailPage.test.tsx`: the gap k>0 wire pin and the ~:2037/~:2083 once-value removals.
  
  No other existing test file changed.
- C1 (HEL-1294/1321): the `markCreating` calls are untouched. Immediate creates set no `renderKey`, and a draft keeps `renderKey = temp id` (`temp?.renderKey ?? renderKey`, equivalent to the old `s.renderKey ?? s.id`). I mutated `markCreating(tempStep.id, true)` to `false`: `creatingStep` gave 3 failed, 1 passed (`hel1345-eval-mut3.json`), so the guards bite.
- C2: no `ci.yml`, `playwright.config.ts`, `.gitignore` or `helio-mcp/package*.json` in the diff (`git diff --name-only` grep: empty). The executor's `npm --prefix helio-mcp ci` changed no tracked file.
- `openspec validate rootid-step-create-placement --strict`: valid. All three MODIFIED requirement headers match the live specs verbatim.
- C8 dev-DB residue: I ran a read-only (`BEGIN TRANSACTION READ ONLY`) check scoped to the exact ids listed in `probe-evidence.md`. Result: users 0/14, pipelines 0/13, data_sources 0/13, and 0 steps of the listed pipelines.

### Phase 2: Code Review — FAIL
Gates, run fresh in `WORKTREE_PATH`:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test`: root 375/375, frontend 442 suites, 4616/4616.
- `npm --prefix frontend run build`: exit 0.
- `nice -n 19 sbt testFull`: 6051 run, 433 suites, 0 failed, 0 aborted, exit 0. `sbt --client shutdown` was run as a separate call.
- `npm run check:scala-quality`: clean.

My own frontend mutations, run in the throwaway worktree:
- `reparentedStepIds` ignored in the hook: `createPlacement` 7 failed ((a), (b) x2, (c), (d) x2, (h)). This matches the executor.
- An after-anchor sent as an append (`insertWireArgs`): 4 failed ((a), (c), (d) x2). This matches the executor.

Timeout commit `b336718d9` (`jest.setTimeout(20000)`): measured per-test durations of 359–1849 ms while `sbt testFull` was loading the machine (`hel1345-eval-place.json`). The heaviest test is (a) at 1.85 s. Nothing hangs. A hang would still fail at 20 s, so the bound does not mask one; it only delays detection. Justified, with one suggestion below.

Issues:
1. **CONTRIBUTING.md "Imports & Qualifiers" violation (inline FQN).** `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:2566` has `@scala.annotation.tailrec` inlined in new code (`resolveRootTrunkAnchor`'s `walk`). The rule reads "Always import at the top of the file; never inline a fully-qualified name when an `import` would do". `check-scala-quality.mjs` does not list `scala.annotation.` among its `FQN_PREFIXES`, so the hook passed, but the written rule binds. The established form already exists in the repo: `ProvenanceService.scala:11` has `import scala.annotation.tailrec`.

Everything else checked clean:
- Type safety: no `any`. The `as unknown as PipelineStep` casts are test-only, used to model the wire `reparentedStepIds`.
- Error handling: the rootId arm's list read sits outside `.recover`, the same as the `parentStepId` arm.
- No TODO/FIXME.
- The pure resolver is shared by placement and the pre-check (DRY with D3).
- `applyCreatedStep` and `insertAnchor` are small, pure and unit-tested.

### Phase 3: UI Review — PASS
Servers started with `start-servers.sh` and `assert-phase.sh servers` printed PASS. cwd verified with `readlink /proc/<pid>/cwd`: 6777 maps to `.../HEL-1345/frontend` and 9684 to `.../HEL-1345/backend`. Playwright ran with 1 worker under `nice -n 19` in its own headless context, and every spec used a throwaway user.

- Happy path: the executor's `e2e/hel1345-rootid-step-placement.spec.ts` passed on my ports (append and gap insert, reload, then UI order and API parent chain `limit, cast, sort, select`).
- My scratch spec (not committed) checked these, and passed:
  - keyboard access: the gap-0 insert was driven by focus plus Enter on "Insert step here";
  - gap-0 placement: `Cast, Limit, Sort` in the UI, and the API chain after reload is `cast, limit, sort`;
  - the failure path: an injected 500 on POST steps shows the toast "Failed to add select fields step: boom", the page is not blank, and the temp card is kept.
- Console: no JS errors or page errors. The only failed requests were `GET /schedule` 404 (a pipeline with no schedule, pre-existing semantics) and my injected 500.
- Breakpoints 1440 / 1100 / 768 / 375: horizontal overflow (`scrollWidth - innerWidth`) was 0 at each one, measured in `hel1345-eval-pw.log`.
- Cleanup: the 3 throwaway users I created (`13a9b48e-b2aa-49f2-91c2-d5310ff9e2e1` from the e2e spec; `5061772a-2b0a-462f-9318-719b55b3253e` and `38ed9c4a-f0ed-425a-b741-460263d9ee8c` from my scratch spec) were deleted by exact id. Their pipelines and sources were deleted through the API, and I confirmed all of them absent by id.

### Overall: FAIL

### Change Requests
1. `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:2566`: replace `@scala.annotation.tailrec` with `@tailrec` and add `import scala.annotation.tailrec` to the file's top-level imports (next to `import scala.concurrent.{ExecutionContext, Future}`, line 30). This is CONTRIBUTING.md "Imports & Qualifiers"; the precedent is `ProvenanceService.scala:11`. Re-run `PipelineStepRootIdPlacementRoutesSpec` and `PipelineStepReparentRoutesSpec`.

### Non-blocking Suggestions
- `frontend/src/features/pipelines/services/pipelineService.ts`: `CreatedPipelineStepWire` and `CreatedPipelineStep` are the same type (`PipelineStep & { reparentedStepIds?: string[] }`). Use one.
- `openspec/changes/rootid-step-create-placement/specs/pipeline-steps-persistence/spec.md`, the `position` k bullet: "the step that occupied the slot SHALL become its child" omits that ALL of the anchor's children move, tails included. The scaladoc and schema already say so. The guard bullet's enumeration ("an insert whose slot is occupied") likewise misses `position == trunk length` onto a tail-bearing trunk-last step. The normative "exactly when this placement would re-parent" clause is correct.
- `PipelineDetailPage.draftCreate.test.tsx` ~:427: the retargeted assertion counts one expanded "Generate text" card but does not pin WHICH card (`ai-1` versus the duplicate `ai-2`). Asserting on the first card would make the intent explicit.
- `PipelineDetailPage.createPlacement.test.tsx`: a file-wide `jest.setTimeout(20000)` is the only one in `frontend/src`. Consider scoping it to case (a) via the `it(..., timeout)` argument.
- The `console.log` id record in the e2e spec is fine for operator cleanup. The spec leaves its throwaway user behind on every run, by design, since there is no delete route.
