## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `c23107e5569e97e9621163e7da505f9f18d80121` (single commit on top of live-resolved base `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39`).
Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1483/evidence/eval-1/`.

### Phase 1: Spec Review — FAIL

- AC1 (probe before fix): PASS. `probe-base-*.txt` and `red-switch-test-on-base.txt` show the bug on base. On base, 8 of the 9 switch tests fail; the one that passes is the `limitInputs` sanity check.
- AC2 (B's steps only, through every route): PASS. I checked this in the running app with my own data: sidebar, command-palette search, palette recents, and browser back and forward each landed on exactly the target pipeline's cards. After every switch, the only requests were the 5 boot GETs, all for the target id.
- AC3 (no cross-pipeline write): PASS. An edit on B sent `PATCH /api/pipeline-steps/<B step id>` only. Jest covers the A-debounce drop, late fetch, late run and late rename.
- AC4 (analyze uses B only): PARTIAL. It holds in the running app (after the switch, `/analyze` went only to B's id). The jest assertion that claims to cover it is vacuous, though; see CR2.
- AC5 (no per-pipeline state leak): PASS. The page is keyed on the route id, so a switch remounts it; the reset list is in `PipelineDetailPage.tsx`'s comment and matches design D2.
- AC6 (red/green regression test; e2e only if needed): PASS. The test drives the real exported `PipelineDetailPage` through `MemoryRouter` navigation (C1 satisfied: the key lives inside the exported page). No e2e is needed: palette, recents and back/forward are all router navigations of the same route, I checked them live, and they are structurally covered by the key.
- AC7 (gates): PASS (my own runs, below).
- Design D2a: DIVERGENCE (CR1). The design accepts "a loading state for the steps until the fetch lands". The implementation instead shows the "No steps yet" empty state while waiting.
- D6 sites (create modal, `?outputId=` links, source-conflict links): the executor did not probe these separately. Any `:id` change now remounts the page through `key={id}`, so they are covered by construction. Not blocking.
- Constraints: C1 honored. C2 honored. Slice guards scope by `meta.arg`. A superseded `fetchPipelineById` returns early, and the latest request settles the status itself (the reducer test "never strands status at loading" covers this). A different id's request clears the previous error. The hook disowns status and error for any other id.
- Tasks: all checked, and they match the diff. No scope creep: only `frontend/src/features/pipelines/**` and the change dir changed.

### Phase 2: Code Review — FAIL

Gates (fresh, run in WORKTREE_PATH):
- `npm run lint`: PASS (zero warnings). No new `eslint-disable` anywhere in the diff.
- `npm run format:check`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS. 518 suites / 5563 tests, plus a 45-suite / 441-test project (exit 0).
- `npm --prefix frontend run build`: PASS.

Changes to existing tests (scrutinized, none weakens coverage):
- `pipelinesSlice.test.ts` `submitPipelineRun` tests now dispatch `pending` before `fulfilled`/`rejected`. A real thunk always dispatches `pending` first, and the new `runPipelineId` guard depends on it, so this models production more faithfully. The assertions are unchanged.
- `usePipelineDetailPage.analyze.test.tsx` T2 still asserts exactly one analyze over 1s (the F-105 invariant). It now also asserts 0 steps at first render and 2 after the fetch, which is D2a's intended behaviour.
- The T3 render-count baselines rise by exactly 1 each (5/6/8 to 6/7/9). That matches the one added `setStepsFetchedThisMount` render, and the comment documents it. Acceptable.

Code: the key remount is the minimal, robust fix, and the slice guards are scoped and readable. The non-blocking items below are not defects.

Issues:
1. Vacuous assertion (CR2). `frontend/src/features/pipelines/ui/PipelineDetailPage.switch.test.tsx`, in the test "does not issue a request carrying one of A's step ids once B is showing", runs `for (const call of jest.mocked(analyzePipeline).mock.calls.slice(1)) { expect(call[0]).not.toBe(""); }`. No pipeline id is ever `""`, so this passes for any analyze call, including one for A. AC4 has no real jest coverage.
2. Evidence defect, not blocking on its own. `evidence/mutation-key-and-D2a-no-slice.txt` is a TypeScript compile failure (`TS2339 currentPipelineRequestedId`, "Tests: 0 total"). It is not evidence that the slice guards are needed. The per-guard mutations (`mutation-no-stale-fetch-guard.txt`, `mutation-no-run-guard.txt`) do each turn exactly one test red, so the guards are covered individually. Don't cite the compile-failure file as a mutation result.

### Phase 3: UI Review — FAIL

Setup: dev servers on 6915/9822 (`start-servers.sh` reused the already-healthy servers and `assert-phase servers` passed). I used a throwaway user `hel1483-eval-1791712255742@example.com`. Pipeline A `2817f074-bb89-4059-beb8-013e1f13acd9` had 3 steps and pipeline B `341bc9a6-8419-4cb2-98e5-343216e043e3` had 1, both on source `fa10d783-0609-4653-8793-117bc48efcba`. All three were deleted by exact id afterwards (204 each). The user row remains, since there is no user-delete API.

- Happy path: PASS. Sidebar A to B, back, forward, palette search, palette recents: correct cards every time. Edit B, switch to A, back: B shows the saved edit (limit = 1), which is the D2a revisit scenario.
- Loading on switch: PASS while the pipeline fetch is pending. The page skeleton shows and A's name or cards never appear on B (D5c). Screenshot: `eval-1/hel1483-eval-switch-loading-light.png`.
- Loading while the steps fetch is pending: FAIL (CR1). Once `currentPipeline` has loaded but before this mount's steps fetch fulfils, the river renders `PipelineRiverView`'s "No steps yet" empty state for a pipeline that does have steps. It shows "Add your first transformation step…", active "+ Add step" and "Add Outputs from a shape" buttons, and "0 steps" in the footer. My DOM sampler caught this frame on the live back-nav to A (`13acd9 | [] | skel=false` before the 3 cards). With `/steps` delayed it stays put; screenshot `eval-1/hel1483-eval-revisit-steps-pending.png`, B revisit. On base, a revisit seeded from cache and never showed this state. After this change it appears on every in-app switch and revisit, for the length of the steps round-trip, which on prod latency is visible and clickable.
- Console: no app console errors. The only errors are network 404s for `/schedule` (no schedule set), which happen on base too.
- Themes: light shows skeleton then loaded cards correctly (`eval-1/hel1483-eval-switch-loaded-light.png`); dark was checked live. No CSS changed.
- Breakpoints: back/forward switch at 768 and 375 rendered correct cards with no horizontal overflow. 1440/1100 are default-viewport equivalents and no layout code changed.
- Accessibility: unchanged; no new interactive elements.

### Overall: FAIL

### Change Requests
1. **CR1 (D2a: false empty state while this mount's steps fetch is pending).** `frontend/src/features/pipelines/ui/PipelineRiverView.tsx:328` renders the "No steps yet" EmptyState and its action buttons whenever `steps.length === 0`. Since this change, that includes the window before `stepsFetchedThisMount` (`usePipelineDetailPage.ts:152`) turns true. Expose a "steps not yet loaded for this mount" flag from `usePipelineDetailPage` (for example `!stepsFetchedThisMount`, or this mount's `stepsStatus[id]` not yet `succeeded`). While it is set, render the steps area's loading skeleton instead of the empty state, the "+ Add step" / "Add Outputs from a shape" CTAs, and the "0 steps" footer count. That is what design D2a accepted: "a loading state for the steps". A genuinely 0-step pipeline must still show the empty state once its fetch has fulfilled. Add a jest case to `PipelineDetailPage.switch.test.tsx`: A to B with B's `getPipelineSteps` held unresolved asserts `queryByText("No steps yet")` is null, then resolves and asserts B's 1 card. Show it red without the fix.
2. **CR2 (vacuous AC4 assertion).** In `frontend/src/features/pipelines/ui/PipelineDetailPage.switch.test.tsx`, test "does not issue a request carrying one of A's step ids once B is showing", replace the `expect(call[0]).not.toBe("")` loop. Record `analyzePipeline`'s call count right before the switch, and assert every later call has `call[0] === "B"` (and that there is at least one). Show it fails under a mutation that dispatches `analyzePipeline` for the previous id after the switch, or explain in the evidence why it can't be mutated.

### Non-blocking Suggestions
- `usePipelineDetailPage.ts` (571 lines) and `pipelinesSlice.ts` (707) are past CONTRIBUTING's ~400-line "propose a split in the PR description" threshold and grew in this diff. Mention a split in the PR body.
- If `fetchPipelineSteps` rejects, the editor never seeds and silently shows an empty river. On a cold open this already happened on base, but a revisit used to fall back to cache. Once CR1 lands, consider giving the steps area an error/Retry state when this mount's steps fetch fails. A follow-up is fine.
- `PipelineDetailPage.switch.test.tsx` has a "limitInputs helper sanity" test that checks nothing related to the ticket. Consider dropping it.
- Dev-DB residue: the throwaway users `hel1483-*` (the executor's ~7 plus my 1) remain, because there is no user-delete API.
