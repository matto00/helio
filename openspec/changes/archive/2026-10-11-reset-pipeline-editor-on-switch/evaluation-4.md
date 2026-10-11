## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed HEAD: `18bed65e964b03177f812ceb985176eb36509984`. The cycle-4 delta is commit `18bed65e9`; base `bc8ccac45` was resolved live.
Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1483/evidence/eval-4/`. The two load-bearing files are `live-late-root-mid-edit.txt` and `mutation-no-ownPipeline-keep-skip.txt`.

### Phase 1: Spec Review — PASS

**evaluation-3 CR1 is resolved in behaviour.** I re-ran my cycle-3 repro in the running app on this HEAD:
- A's root DELETE was held for 5 s. I switched to B, opened B's card and edited it mid-debounce.
- `PATCH /api/pipeline-steps/<B step> {"count":1}` was sent at 16290 ms, and the server now has `count: 1`.
- No page skeleton appeared after B loaded, and no GET for A was sent after the switch.
- The red evidence (`red-late-root-keeps-B-edit-on-HEAD-b5a68488f.txt`) shows the new tests red on the previous HEAD.

**C2 is honoured:**
- `ownPipeline` is only ever set from `storedPipeline` when `storedPipeline.id === id`, both in the initializer and in the render-phase update, so A's data can never land on B.
- The 404/403 error view still replaces the kept editor through `ownRequestFailed`. Two checks back this up:
  - Live: an unknown id shows "Couldn't load this pipeline" with the not-found copy.
  - My mutation that drops `ownRequestFailed` turns the 403 and 404 error-state tests red (`mutation-no-ownRequestFailed.txt`).

**No refetch loop.** The convergence effect now keys on `singletonIsOwn`, and a `failed` status never triggers it. Live: the 404 id sent its 5 boot GETs once and nothing more over 4 s. Back and sidebar navigation then load correctly.

All other ACs are as recorded in evaluations 1 to 3.

### Phase 2: Code Review — FAIL

**Gates** (fresh, run in WORKTREE_PATH):
- `npm run lint`: PASS, zero warnings.
- `npm run format:check`: PASS.
- `npm run typecheck`: PASS, exit 0.
- `npm test`: PASS. 518 suites / 5570 tests, plus a 45-suite / 441-test project; exit 0.
- `npm --prefix frontend run build`: run 3 times, exit 0 each time. **The executor's `build exit=254` did not reproduce.**

**T3 render-count baselines (6/7/9 to 7/8/10):** the bump is justified. The render-phase `setOwnPipeline(storedPipeline)` runs once when the singleton first becomes this page's pipeline. That is one extra render pass, and it shows up in every checkpoint because it happens at open. The comment documents it.

**Issue: the new `ownPipeline` mechanism is not guarded by any test.** This is the mutation the orchestrator asked for, run in a throwaway detached worktree at `18bed65e9` that I removed afterwards.
- I replaced `currentPipeline = singletonIsOwn ? storedPipeline : ownRequestFailed ? null : ownPipeline` with `singletonIsOwn ? storedPipeline : null`, so `ownPipeline` is gone but the unmount skip stays.
- `PipelineDetailPage.switch.test.tsx` still passed, 16 of 16 (`eval-4/mutation-no-ownPipeline-keep-skip.txt`).
- The executor's own `mutation-no-unmount-skip-still-green.txt` shows the converse: with the skip removed, the tests are still green.
- So the two new tests guard the outcome (B's edit survives) only jointly. Neither mechanism is individually failable, and **the tests guard the skip, not the interleaving**.
- In the shipped code the skip removes every known late `fetchPipelineById(other id)` producer (the root add/remove continuations), so `ownPipeline` currently only runs if some future late dispatch appears. It is defence-in-depth that nothing exercises, against the checklist item "new code paths exercised; tests would catch a real regression". See CR1.

**Code otherwise:**
- `mountedRef` in `usePipelineRootAndToggleActions.ts` is simple and correct. The "Source removed" toast still fires after unmount, which is harmless and was already the case on base.
- The render-phase `setState` follows the derived-state pattern the hook already uses for its step seeding.

### Phase 3: UI Review — PASS

**Setup:** I started servers on 6915/9822 with `start-servers.sh` and `assert-phase servers` passed. I used throwaway user `hel1483-eval4-1791716274810@example.com` and created:
- A `439c4115-d81c-4e87-84f4-cc90e7164d5f`
- B `276857be-f870-4094-8633-917cd74b428a`
- sources `76c9f344-f4dd-4f1f-b460-60e290e0c7dd`, `dc9e6f5c-663d-4aec-bde3-bc9ce1454673`, `e9482caa-5f20-4be0-acd9-85789ae9c151`

All five were deleted by exact id (204 each). My servers were stopped by exact PID: sbt 4089656/4089698/4089993 and npm/vite 4090637/4090652. Both ports are now free.

**Checks:**
- Mid-edit held-request repro: PASS. The B PATCH is sent and the editor stays mounted (transcript above).
- 404 view, back, and sidebar switching all render correctly.
- Console: only the expected `/schedule` 404s and the deliberate unknown-id 404.
- No markup or CSS changed this cycle. The theme and breakpoint results from cycles 2 and 3 stand.

### Overall: FAIL

### Change Requests
1. **Make `ownPipeline` failable by mutation, or remove it.** Prefer the test; the skeptic asked for defence-in-depth here. In `PipelineDetailPage.switch.test.tsx`, add a test that bypasses the root continuations:
   1. Open A.
   2. Switch to B and let it fully load.
   3. Expand B's card and change its limit.
   4. Inside the 400 ms debounce, call `store.dispatch(fetchPipelineById("A"))` directly on the test store. Let it resolve with `pipelineOf("A")`.
   5. Assert that `queryByLabelText("Loading pipeline")` stays null, that "Pipeline A" never renders, that `updatePipelineStep` is called with `("b1", …)`, and that the card is still expanded.
   6. Show it red under the mutation in `eval-4/mutation-no-ownPipeline-keep-skip.txt` and green on HEAD.

   If the team decides the skip alone is enough, delete `ownPipeline` / `ownRequestFailed` and the `singletonIsOwn` plumbing instead, and restore the 6/7/9 render baselines. Do not keep untested guard code.

### Non-blocking Suggestions
- Carried over: the duplicated river-skeleton markup, the triplicated `render*Settled` helper, and a note in the PR body proposing a split for `usePipelineDetailPage.ts` / `pipelinesSlice.ts`, which are over ~400 lines.
- PR body: state that A's "Source added/removed" refetch is intentionally skipped once the A page has unmounted. The next visit to A re-fetches it anyway.

### Critical Path

This is the final, extended cycle and the verdict is FAIL. The only open item is CR1, a missing guard test (or removing defensive code that nothing exercises). It is not a product defect:
- Every user-visible behaviour the ticket and spec require now holds and is verified live: no stale steps on any route, no cross-pipeline write, a late A request cannot unmount or blank B, A's late run and load are ignored, and the error views work.
- All gates are green and the build is stable.

**Recommendation for the human:** this is safe to merge as is, with a follow-up ticket for the mutation-guard test, or after a tiny fix of about 15 lines of test. If merging now, the PR body should say that `ownPipeline` is defence-in-depth and not yet mutation-guarded.
