## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `ba07d0e8b809cd5f8464888c8ca460512914598c`. Base `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39` was resolved live. The cycle-2 delta is commit `ba07d0e8b`.
Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1483/evidence/eval-2/`.

### Phase 1: Spec Review — PASS

- **CR1 (cycle 1), D2a false empty state: resolved.**
  - `usePipelineDetailPage` now tracks this mount's steps fetch as `"pending" | "fulfilled" | "failed"` and exposes `stepsLoading`.
  - While the fetch is pending, `PipelineDetailPage.tsx` renders the river skeleton instead of `PipelineRiverView`, and the footer hides the step count (`stepCount: number | null`).
  - A rejected fetch settles to the empty editor, which is what a cold open on base shows, so the skeleton is never stuck.
  - A genuinely empty pipeline still shows "No steps yet" once its fetch has fulfilled. Both cases have tests.
- **CR2 (cycle 1), AC4: resolved.**
  - The vacuous `not.toBe("")` loop is gone.
  - The new test "every analyze request after the switch is for B (AC4)" records the call count before the switch, waits for at least 2 calls after it (the open's analyze plus the debounced re-analyze after an edit), and asserts every one has id `"B"`.
  - `mutation-analyze-wrong-id.txt` shows it failing on exactly that line (expected `["B","B"]`, received `["B","A"]`).
  - `mutation-no-steps-skeleton.txt` turns the D2a skeleton test red.
- All ACs from evaluation-1 still hold. C1 and C2 are honored. No scope creep.

### Phase 2: Code Review — PASS

**Gates** (fresh, run in WORKTREE_PATH):
- `npm run lint`: PASS, zero warnings. The only `eslint-disable` strings in the diff are prose in the openspec docs.
- `npm run format:check`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS. 518 suites / 5566 tests, plus a 45-suite / 441-test project; exit 0.
- `npm --prefix frontend run build`: PASS.

**The 23 existing tests moved to `renderDetailPageSettled` / `renderPageSettled`** (in `PipelineDetailPage.test.tsx`, `.draftCreate.test.tsx` and `.creatingStep.test.tsx`).

The helper is the same render plus one `await act(async () => {})`, which flushes the mocked, already-resolved steps fetch. It adds no assertion and removes none: every following interaction and expectation is byte-identical. Those tests click "+ Add step" or "Add Outputs from a shape". Before this change those controls were available at first render; now they correctly exist only after the fetch settles, which is the behaviour CR1 asked for. Coverage is not weakened.

The removed "limitInputs helper sanity" test was filler, as suggested in cycle 1.

**Code:** the change is small and readable, with no new type escape hatches. Seeding stays a derived-state update during render, so the transition from fulfilled to seeded commits in one pass and never shows an empty-river frame in between. I confirmed this live: no `[]` + "No steps yet" sample.

### Phase 3: UI Review — PASS

**Setup.** The dev servers on 6915/9822 passed `assert-phase servers`. They were the ones `start-servers.sh` launched in cycle 1 at 02:50 local, with cwd in this worktree. I used throwaway user `hel1483-eval2-1791713738666@example.com` and created:
- pipeline A `a9ab8474-b6d5-48d1-acef-a0a86008e6a4` (2 steps)
- pipeline B `f89892c3-609c-4d27-8448-3d57bddf934e` (1 step)
- pipeline C `b63d1d8f-5cac-4ad7-9b00-59b7404b6e9e` (0 steps)
- source `6b5ff859-f59b-4a9b-95af-019a4bb08335`

All four were deleted by exact id afterwards (204 each). The user row remains because there is no user-delete API.

**Checks.** A DOM sampler at 15 ms tracked step labels, "No steps yet", the steps skeleton and the footer count.
- **Sidebar A→B:** A's cards, then the page skeleton, then exactly B's 1 card and "1 step". "No steps yet" never appeared. The only requests were B's 5 boot GETs.
- **Revisit B→A with `/steps` held for 5 s (dark theme):** the steps skeleton showed, with no count and no "No steps yet" (`eval-2/hel1483-eval2-revisit-steps-pending-dark.png`). It then went to A's 2 cards and "2 steps".
- **Same revisit in light theme** with `/steps` held for 6 s: the skeleton renders correctly (`eval-2/hel1483-eval2-revisit-steps-pending-light.png`), then B's 1 card.
- **Empty pipeline C:** "No steps yet" and "0 steps" appear after the fetch, as expected.
- **Back and forward between A and C:** correct each time.
- **Palette search to B:** correct, and every request was for B.
- **Console:** on port 6915 the only errors were the expected `/schedule` 404s (no schedule set), which base also produces.
- **Breakpoints:** no layout CSS changed. The skeleton reuses the existing `pipeline-detail-page__river*` / `__ribbon` classes from `PipelineDetailSkeleton`. 768/375 were checked in cycle 1.

### Overall: PASS

### Non-blocking Suggestions

- **Accessibility.** `PipelineDetailPage.tsx` puts `aria-label="Loading steps"` on a plain `<div>` with no role. ARIA ignores names on generic elements, so assistive tech announces nothing. Consider `role="status"` or `aria-busy="true"` on the tabpanel. It would also make a better test hook than the text query.
- **DRY.** The steps-skeleton markup in `PipelineDetailPage.tsx` duplicates the river block of `PipelineDetailSkeleton.tsx`. A small shared `PipelineRiverSkeleton` would keep the two from drifting.
- **Test helper duplication.** `renderPageSettled` / `renderDetailPageSettled` is defined three times across the test files. Acceptable for test code.
- **File size, carried over from cycle 1.** `usePipelineDetailPage.ts` and `pipelinesSlice.ts` are over CONTRIBUTING's ~400-line threshold. Mention a split in the PR body.
- **Housekeeping.** I stopped the lane's dev servers by exact PID at the orchestrator's request: sbt launcher 3506949/3507007/3507473 and npm/vite 3507980/3508005. Both ports now refuse connections. Playwright artifacts from another lane (port 6738) in the main checkout's `.playwright-mcp/` were left in place.
