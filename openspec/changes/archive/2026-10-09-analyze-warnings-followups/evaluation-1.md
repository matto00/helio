## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `e88dc69bb901bfda07236d2a5991ee9c7ec1306c` against the live-resolved base `365d824c8f2eba017e150e9b5f67743920f56619` (origin/main).

### Gates (my own fresh runs, in WORKTREE_PATH)

- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0. `helio-mcp` `npm run typecheck`: exit 0
- `npm test`: root jest 44/44 suites, 433 tests (this includes `helio-mcp/src/context.test.ts` and `server.test.ts`); frontend 500/500 suites, 5234 tests; all pass
- `npm --prefix frontend run build`: exit 0
- `cd backend && sbt -J-Xmx3g testFull` (nice 19): **6500 succeeded, 0 failed**, 4 canceled (pre-existing env-gated specs). The log shows the new HEL-1414 cases in `AnalyzeSchemaWarningsSpec` and `PipelineAnalyzeSchemaWarningsSpec` ran
- `npm run check:scala-quality`: clean (soft warnings only)

### Phase 1: Spec Review — PASS
- AC1–AC7 are each addressed. AC1 placement, copy and non-blocking behaviour match owner ruling A and D6. The DOM order is header → warnings region → outputs-rail → body, checked live.
- AC3/AC4 (D1/D1b/D2) work on the restarted backend running this HEAD (see Phase 3).
- AC5: the `analyze_pipeline` concise wording no longer says "no column lists". `server.test.ts` pins the new wording.
- AC6: the spec header now points at archived `evaluation-1.md` ("My own mutation runs", which exists at line 28) and `evaluation-2.md`. The correction note on archived `tasks.md` 1.3 matches `AnalyzeSchemaWarnings.typeTrusted`'s scaladoc (lines 55–62).
- AC7 / C1:
  - The only consumers of `AnalyzeSchemaWarnings.compute` are the three `warnings` sites (PipelineService.scala:1010, 1149, 1471).
  - `secondarySourceIdOf` only widens the secondary-schema map. `analyzeNodes` still resolves through join-only `sourceDependencyOf` (PipelineAnalyzeService.scala:279), so projections, validationError and costVerdict are unchanged.
  - The HEL-1235 "never blocks" cases are unmodified (that spec's diff is only the header comment plus appended cases). No HEL-1279 or RunConfigGate file is in the diff.
  - Live: the warned pipeline returned `canRun: true`, `reasons: []`, and no step had a validationError. A dry run fired (`blocked: false`).
- C3 is honoured: warning tokens only, no `--errored` class, and the copy never says "can't run".
- Every task is ticked, and tasks match the implementation. No scope creep.

### Phase 2: Code Review — FAIL
Issues:

1. **Tests don't cover the data flow from analyze results to cards (tests meaningful).** I ran mutations in a throwaway detached worktree at the reviewed SHA; it has since been removed.
   - **Hook mutation (main gap).** I changed `getAnalyzeWarnings` in `usePipelineDetailPage.ts:635-638` to always return `EMPTY_ANALYZE_WARNINGS`. All 98 pipeline suites (1347 tests) stayed green. That means a regression that removes every warning from the editor would pass every gate. The `warningsByStepId` grouping (`usePipelineDetailPage.ts:625-633`) has no test at all.
   - **Branch-lane mutation.** I replaced `warnings={getAnalyzeWarnings?.(step.id)}` at both `LaneColumn.tsx` sites (lines 228 and 281) with `undefined`. The HEL-1414 `PipelineRiverView` tests stayed green. I also stopped `PipelineRiverView.tsx:451/530` from forwarding `getAnalyzeWarnings` to `LaneColumn`/`RootColumn`; those tests stayed green too. They only exercise the trunk StepCard site (`PipelineRiverView.tsx:387`), and that mutation did go red. So the RootColumn → LaneColumn → StepCard threading that D6 and task 2.2 require ("every StepCard call site") is untested. I confirmed live that it works: a tail-lane step under `pipeline-detail-page__tail-chain` showed its indicator.
   - **StepCard tests are behavioural, not just type-gated.** The executor's frontend "red" was compile-only (TS2353, "Tests: 0 total"). My mutations each turned the StepCard HEL-1414 tests red (1 failed each):
     - region never rendered
     - card marked `--errored` when warned
     - count never shown
     - heading copy changed to "can't run"
2. **New inline fully-qualified name (CONTRIBUTING.md "Imports & Qualifiers": never inline an FQN when an `import` would do).** `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala:175` adds `scala.util.Try(...)`. Two pre-existing instances are in the same file (lines 213, 227), and `check:scala-quality` doesn't scan `scala.util`, but the new line is still a fresh violation of the rule.

Everything else checked out:
- **CSS placement / tokenAuditSweep.** This is legitimate, not a sidestep. The diff adds lines only after line 1910, extending the existing `.pipeline-detail-page__truncation-banner` rule into a combined selector (as D6 requires) and adding new rules next to it. No existing lines moved. `tokenAuditSweep.css.test.ts`'s last pinned `PipelineDetailPage.css` baseline entry is line 1452, so nothing shifts. The new lines are still swept, and they use only `--space-*`, `--text-xs`, `--weight-*` and `--app-warning*`. `tokenAuditSweep` passes.
- **Backend logic.** `lookupKeyWarnings` mirrors `joinWarnings`' key checks under the same gates. `viaLane` correctly keeps a source-secondary lookup's output type-untrusted. The guard-mutation red evidence is genuine: the executor's `backend-guard-mutation-red.txt` shows 1 failed. Backend reds are behavioural (5 and 2 failed test cases, not compile errors).
- **Security.** Lookup source ids that are now loaded for warnings were already cross-owner-validated on write (`PipelineStepConfigCodec.secondaryDataSourceId` covers lookup). That is the same trust model join already uses.
- **helio-mcp.** Grouping by step id, the old-server fallback (missing `warnings` treated as none), and the omit-when-none behaviour are all correct and tested.

### Phase 3: UI Review — PASS
I restarted the stale backend. The listener on 9753 was this worktree's, but it started at 16:23, before the 17:04 commit. I stopped it by exact PID and relaunched it via `start-servers.sh` (new PID started 17:19, cwd is this worktree's `backend/`). The frontend was reused; its cwd is this worktree's `frontend/`.
- **Real analyze endpoint**, throwaway user. The pipeline had two `source`-secondary lookups (string `customer_id` vs float `id`).
  - Full analyze returned:
    - `join-column-renamed` (lookup, `name`→`right_name`)
    - `join-key-type-mismatch` (`lookup: source key 'customer_id' is string … lookup key 'id' is float …`)
    - `field-not-in-input-schema` (`lookup: key 'cust_id' not found in this step's inferred secondary input schema (available: id, name, tier)`)
    - a second rename
  - Concise analyze carried the same messages per node.
  - `canRun: true`, `reasons: []`, no validationError.
  - A dry run fired, and every looked-up column came back null. That confirms the key-mismatch warning is true at run time.
- **Editor, light and dark.**
  - Header indicator: `role="img"`, labelled "2 schema warnings" / "1 schema warning", visible count only when N > 1, visible both collapsed and expanded.
  - Expanded region: "Check before running (these don't block runs)", `role="region"` labelled by its heading, not `role="alert"`.
  - Computed colours are `--app-warning` / `--app-warning-surface` in both themes (light `#85551a`, dark `#f5b944`).
  - No card has `--errored`. Dry run and Run pipeline stay enabled.
  - Keyboard: Enter on the focused header button expands the card.
- **Refresh flow.** I fixed the second lookup's `lookupKey` in the editor. Re-analyze cleared that card's indicator and region. No downstream false mismatch appeared after the source-secondary lookup, which is the D2 guard behaving as designed.
- **Tail lane (LaneColumn path).** Indicator renders live.
- **Breakpoints 1440 / 1100 / 768 / 400.** The region stays inside the card, with no horizontal overflow (`scrollWidth == innerWidth`).
- **Console.** Only the pre-existing `GET …/schedule` 404 for a pipeline with no schedule. Not introduced by this change.
- **Evidence** (persisted via `persist-evidence.sh`, refs as returned):
  - `/home/matt/Development/helio/.concertino/runs/HEL-1414/evidence/.concertino/runs/HEL-1414/evidence/eval-c1-lookup-expanded-light.png`
  - `…/eval-c1-lookup-expanded-dark.png`
  - `…/eval-c1-collapsed-with-tail-dark.png`
  - `…/eval-c1-768-light.png`
  - `…/eval-c1-400-light.png`
  - Originals are in `/home/matt/Development/helio/.concertino/runs/HEL-1414/evidence/eval-c1-*.png`.

### Overall: FAIL

### Change Requests
1. **Add a test for the hook's warning grouping**, so a regression that drops every warning goes red. Either:
   - test `usePipelineDetailPage` (or a `PipelineDetailPage` render with a mocked analyze result), asserting that `getAnalyzeWarnings(stepId)` returns that step's warnings in server order, returns the same array identity across re-renders for the same analyze result, and returns the shared empty array for a step with none; or
   - extract the grouping into a small pure helper (e.g. `groupWarningsByStepId`) and test that.

   It must go red under the mutation "return `EMPTY_ANALYZE_WARNINGS` unconditionally" (`usePipelineDetailPage.ts:636`). Record the red.
2. **Add a `PipelineRiverView.test.tsx` case for a non-trunk step.** Use a tail/branch lane step rendered through `RootColumn` → `LaneColumn`, and assert that its card shows the warning indicator. It must go red when `LaneColumn.tsx:281` (and :228 where reachable) pass `warnings={undefined}`. Record the red.
3. **Fix the inline FQN** at `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala:175`: add `import scala.util.Try` at the top of the file and call `Try(...)`. Fixing the two pre-existing instances at :213/:227 at the same time is optional but harmless.

### Non-blocking Suggestions
- `StepCard.test.tsx`'s placement test says "before the Outputs rail" but only asserts the region comes before `step-card-body`. Add an `outputs-rail` index assertion to match its name; I verified the live DOM order is correct.
- `StepCard.tsx` is now 507 lines and `usePipelineDetailPage.ts` 1443. CONTRIBUTING says that once a file is over ~400 lines, you should propose a split in the PR description.
- **For the skeptic (judgment):** the region differs from the optionA mockup. The mockup has a TriangleAlert icon beside the heading and a bolder heading; the implementation has no icon in the region and a medium-weight heading.
- `resolveSecondarySourceSchemas` now also loads lookup source schemas on the non-warning call sites (PipelineService.scala:363, 1348). That adds one extra read per source-secondary lookup, with no behaviour change, since `analyzeNodes` ignores those ids.
- The duplicate `id="lookup-key"` across two lookup cards is pre-existing (it surfaced while testing). It's out of scope and a candidate spinoff.

### Environment notes
- Throwaway user `hel1414-eval-c1-1791591610@example.test` (id `9b87ba14-e5d7-47e9-8dca-46ff20e4bc8b`). I created and then deleted, by exact id:
  - pipeline `7954500c-266f-409a-bbfb-7ede65815a89` (its steps, and dry run `773e62f9-8be0-4112-90ee-1e84d6729952`, went with it)
  - data sources `2e0d30d1-e5ac-47f5-ab72-4d22652d3883` and `23377d4e-5014-4557-ba84-35c3535f78a5`

  Deletes returned 204, and both lists are empty afterwards. The user row remains, because there is no account-delete route.
- **Shared-browser hazard.** The Playwright browser was already carrying another evaluator's session cookie: user `hel1432-eval-c1-1791591146@example.com`, from the HEL-1432 lane on port 6864. Cookies on localhost are shared across ports. My `POST /api/auth/logout` to clear it ended that session in the shared DB, so the HEL-1432 evaluator may need to log in again.
- The throwaway mutation worktree has been removed (`git worktree list` shows no stragglers), and `WORKTREE_PATH` has no changes.
