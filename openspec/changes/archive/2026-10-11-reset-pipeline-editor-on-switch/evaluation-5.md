## Evaluation Report — Cycle 5 (evaluation-5.md)

Reviewed HEAD: `89ab0c24f4a3dbcbd5db6fd1f80bd2f17ad51887`. It merges origin/main into the branch on top of `d924f0545`, the cycle-5 test commit.
Live-resolved review base: `f4540f25d38d854746e93cce9c0efe90c5b01a3b`. origin/main is fully contained in HEAD.
Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1483/evidence/eval-5/`.

### Phase 1: Spec Review — PASS

**evaluation-4 CR1 is resolved.** `d924f0545` adds "keeps B's editor and pending edit when a foreign fetchPipelineById(A) resolves on the store" to `PipelineDetailPage.switch.test.tsx`. It skips the root continuations and dispatches `fetchPipelineById("A")` straight onto the store while B is loaded and mid-edit. It then asserts:
- no page skeleton;
- "Pipeline A" never renders;
- B's PATCH `("b1", {count: 66})` lands;
- the card stays expanded.

**I re-ran my exact cycle-4 mutation** in a throwaway detached worktree at HEAD, removed afterwards. The mutation is `currentPipeline = singletonIsOwn ? storedPipeline : null`, which drops `ownPipeline` and keeps the unmount skip.
- The result is `Tests: 1 failed, 16 passed, 17 total`. The new test fails at `PipelineDetailPage.switch.test.tsx:511`, `expect(screen.queryByLabelText("Loading pipeline")).toBeNull()`, and receives the full-page skeleton.
- The unmutated control passes 17 of 17.
- Evidence: `eval-5/mutation-no-ownPipeline-keep-skip.txt`. `ownPipeline` is now failable by mutation and guarded on its own, independently of the skip.

**The test holds B's convergence refetch pending; that hold is legitimate and hides nothing.**
- The hold models the real network window in which the singleton still holds A.
- Without it, the mocked refetch would resolve in the same act flush and put the singleton back on B before the assertions run. The test would then pass with or without `ownPipeline`, the same blind spot cycle 4 found.
- The hold also leaves the request status owned and "loading". That case is exactly the one `ownPipeline` must cover: the page has to keep B's editor and not fall back to the skeleton.
- The hold does not hide whether convergence completes. That is covered separately by the two "B converges … refetches A late" tests, which resolve B's refetch and assert B's name, steps, and no skeleton.

All ACs, C1 and C2, are as recorded in evaluations 1 to 4. No production code changed after cycle 4.

### Phase 2: Code Review — PASS

**Merge check.** None of HEL-1483's files changed between `d924f0545` and `89ab0c24f`; `git diff --stat` over the branch's own file list is empty. The upstream changes in `features/pipelines` are limited to `outputEditor/*` (HEL-1307 conditional formats) and `stepConfigs/WindowConfig*`. The branch's own source diff against the new base is frontend-only (12 files under `frontend/src/features/pipelines/`), so the backend gate does not apply.

**Gates** (fresh, on `89ab0c24f`; MemAvailable was about 47 GB before the full run):
- `npm run lint`: exit 0, zero warnings.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test`: exit 0. 527 suites / 5694 tests, plus a 46-suite / 447-test project.
- `npm --prefix frontend run build`: exit 0.

### Phase 3: UI Review — PASS (sanity check; no production code changed since cycle 4)

**Setup.** I started servers on 6915/9822 with `start-servers.sh` and `assert-phase servers` passed. I used throwaway user `hel1483-eval5-1791743790665@example.com`, confirmed via `/api/auth/me`, and created:
- A `57d6084c-a29c-4440-9a84-05455c12e9f9` (3 steps)
- B `19809d80-ebd9-4cd5-a7f1-04e819503c65` (1 step)
- source `a3b1dfcd-2951-4fcc-89d5-4eb99e4f8e53`

All three were deleted by exact id (204 each).

**Result on the merged head:**
- A showed 3 cards.
- Sidebar to B showed exactly 1 card.
- Back to A showed 3 cards, and forward to B showed 1.
- "No steps yet" never appeared.
- Console showed only the expected `/schedule` 404s.

**Teardown.** I stopped my servers by exact PID: sbt 2184759/2184810/2185706 and npm/vite 2186358/2186392. Both ports are free. My Playwright files are in `eval-5/playwright-mcp/`.

### Overall: PASS

### Non-blocking Suggestions
- Carried over: the river-skeleton markup duplicated between `PipelineDetailPage.tsx` and `PipelineDetailSkeleton.tsx`, and the triplicated `render*Settled` test helper.
- In the PR body, propose a split for `usePipelineDetailPage.ts` / `pipelinesSlice.ts`, which are over CONTRIBUTING's ~400-line threshold.
- Also in the PR body, note that A's root add/remove refetch is skipped once its page has unmounted, and that `ownPipeline` is the mutation-guarded backstop for any other late request for another id.
- Dev-DB residue: the throwaway `hel1483-*` user rows from all cycles remain, because there is no user-delete API. Their pipelines and sources were deleted.
