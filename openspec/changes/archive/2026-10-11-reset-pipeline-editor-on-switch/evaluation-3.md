## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: `b5a68488f1090d4658a905ad27d31d486171cefb`. The cycle-3 delta is commit `b5a68488f`; the base `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39` was resolved live.
Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1483/evidence/eval-3/`. The load-bearing file is `late-root-race-drops-B-edit.txt`.

### Phase 1: Spec Review — FAIL

**What the fix resolves (skeptic-final-1 CR1):** B's page no longer stays blank forever. `usePipelinePageLoad` has a new convergence effect. Once the page has requested its own pipeline (`requestedRef`), a derived state of "idle and my pipeline missing" means another id's request has superseded it, so the effect re-requests `id`.
- `red-late-root-refetch-on-HEAD-ba07d0e8b.txt` shows both new tests red on the previous HEAD. The failure is the right one: the "Loading pipeline" skeleton with no "Pipeline B".
- `probe-fixed-late-root.txt` shows the executor's running-app convergence.
- I reproduced the skeptic's remove-root race live and B converged.

**What it does not resolve:** the spec's rule that "no late-resolving request for the previous pipeline (pipeline load, steps, analyze, or run) SHALL replace the new pipeline's displayed state" (spec.md, the first requirement), and AC3 / D3.3. The late A request still replaces B's page:
- Once B is fully loaded, A's late `fetchPipelineById(A)` lands. The id filter in `usePipelineDetailPage.ts` turns `currentPipeline` into `null`.
- `PipelineDetailPage.tsx:168` then renders the full-page `PipelineDetailSkeleton` until the convergence refetch lands. That **unmounts the whole editor** (StepCards, sheets, dialogs) for one round trip.
- Measured live with the skeptic's remove-root repro: B was loaded at 16314 ms, the skeleton showed from 17205 to 17367, then B came back.
- **This drops user edits on B.**
  - With A's `DELETE /roots/...` held for 5 s, I switched to B and opened its limit card.
  - I set the limit from 3 to 1 at 68136 ms, which arms the 400 ms persist debounce.
  - A's late GET went out at 68346 ms. B unmounted to the skeleton at 68484, before the debounce fired at about 68536.
  - **No `PATCH /api/pipeline-steps/<B step>` was ever sent.** The card came back collapsed and the server still had `{"count":3}`.
  - Positive control: the same edit without the race PATCHes normally (78256 ms).
  - So a request for the previous pipeline silently discards an edit the user made on the current pipeline. That is a cross-pipeline effect AC3 and the spec forbid. Full transcript: `eval-3/late-root-race-drops-B-edit.txt`.

**No loop or refetch storm** (the check the orchestrator asked for):
- After a foreign request, the convergence effect issued exactly one B refetch, in both live runs.
- `failed` (404/403) is a non-idle owned status, so the effect never fires for it. Live: an in-app jump to an unknown UUID sent the 5 boot GETs once and then showed "Couldn't load this pipeline", with no further requests over 4 s.
- Reasoning confirms the remaining case: a failed B followed by a foreign request costs exactly one re-request per foreign request, which matches the code comment.
- StrictMode double-invoke is safe, because `requestedRef` is false on the first idle pass.

All other ACs, C1 and C2 are as recorded in evaluation-2.

### Phase 2: Code Review — FAIL (by the Phase 1 finding; the gates are clean)

**Gates** (fresh, run in WORKTREE_PATH):
- `npm run lint`: PASS, zero warnings.
- `npm run format:check`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS. 518 suites / 5568 tests, plus a 45-suite / 441-test project; exit 0.
- `npm --prefix frontend run build`: PASS.

**Code:**
- The convergence effect is small and well commented, and its no-loop argument holds.
- The `role="status"` addition resolves my cycle-2 a11y note.
- The new tests mock `PipelineDetailHeader` to capture the real `onAddRoot`/`onRemoveRoot`. That is a reasonable way to drive the real handlers from an unmounted page.
- Coverage gap: both new tests hold B's own response until after A's late refetch. Neither covers the skeptic's own reported ordering, where B is fully loaded before A's late refetch. That ordering is exactly the one that still unmounts B's editor.

### Phase 3: UI Review — FAIL

**Setup:** I started servers on 6915/9822 with `start-servers.sh` and `assert-phase servers` passed. I used throwaway user `hel1483-eval3-1791715117981@example.com` and created:
- A `db761a8a-ee29-4420-932a-fb1510fb7ea0`
- B `9fc47fef-0c32-4b87-8859-8a752500ce95`
- sources `8d5a9478-2185-4747-bf14-ba0d372afe59`, `6e01eb9c-ae29-40b3-a69e-ee647d8fbb10`, `17de6ec4-5f7a-4919-9bfb-831d4f5abb60`

All five were deleted by exact id (204 each). My servers were stopped by exact PID afterwards: sbt 3902425/3902475/3903052 and npm/vite 3903752/3903780. Both ports are now free.

**Held-request repro (remove-root, DELETE held 4 s):**
- B converged: correct name and 1 card, and only B's boot GETs plus one B refetch.
- It does flash the full-page skeleton for one round trip after B was already showing, and that flash unmounts the editor, as described above. FAIL.
- Back/forward and the 404 page behave correctly.
- Console: only the expected `/schedule` 404s and the deliberate unknown-id 404.

### Overall: FAIL

### Change Requests

1. **A late request for the previous pipeline must not unmount or blank the current pipeline's loaded editor.**
   - **Where it happens:** `usePipelineDetailPage.ts` maps the stored singleton to `null` whenever its id differs. `PipelineDetailPage.tsx:168` then renders the page skeleton in place of the whole editor. Once this mount has loaded its own pipeline, it must keep rendering it while the convergence refetch runs.
   - **Option 1:** in `usePipelineDetailPage`, keep the last pipeline this mount saw for its own `id` (a ref or state updated when `storedPipeline?.id === id`). Use it as `currentPipeline` when the singleton holds another id. Feed the convergence effect the raw "singleton is not mine and nothing for me is in flight" condition instead of `currentPipeline === null`.
   - **Option 2:** key the loaded pipeline by id in the slice, so another id's fetch never evicts it.
   - **Option 3 (alongside, not alone):** in `usePipelineRootAndToggleActions.ts:54` and `:76`, skip the post-await `fetchPipelineById(id)` / `syncStepsFromServer()` when the page has unmounted.
   - **Test:** add a red-first test to `PipelineDetailPage.switch.test.tsx` for the skeptic's ordering:
     1. Hold A's `addPipelineRoot` or `removePipelineRoot`.
     2. Switch to B and let B's pipeline and steps fully load.
     3. Expand B's card and change its limit.
     4. Resolve A's continuation before the 400 ms debounce elapses.
     5. Assert that `queryByLabelText("Loading pipeline")` stays null throughout, that `updatePipelineStep` is called with B's step id, and that the card remains expanded.
   - Show it red on `b5a68488f`. My live transcript shows what red looks like: `eval-3/late-root-race-drops-B-edit.txt`.

### Non-blocking Suggestions
- Carried from earlier cycles: the duplicated river-skeleton markup (consider a shared `PipelineRiverSkeleton`), the triplicated `render*Settled` test helper, and proposing a split in the PR body for `usePipelineDetailPage.ts` / `pipelinesSlice.ts`, which are over ~400 lines.
- The skeptic's `beforeunload` observation after the stuck state was not re-investigated this cycle. Re-check it once CR1 lands.

### Critical Path

This is the final execution cycle (CYCLE 3 = EXECUTION_CYCLES 3), and Overall is FAIL.

1. **The one blocking issue is CR1 above:** a late `fetchPipelineById` for the previous pipeline briefly replaces the current pipeline's loaded editor with the page skeleton. That unmounts it and silently drops a pending step edit.
   - The fix is small and local: keep this mount's own loaded pipeline rendered during the convergence refetch (option 1 or 2), plus the red-first test for the "B fully loaded first" ordering.
   - Everything else in the ticket is done and verified: the main stale-steps bug, AC1–AC7 otherwise, C1/C2, D2a, the gates, and both themes.
2. **Recommendation for the human:** the defect needs a narrow race. A root add or remove on A must resolve after the user has switched to B, and the user must be mid-edit on B at that moment. Before this branch, the same race showed A's header on B, so it was already wrong, differently. Two reasonable paths:
   - (a) Grant one more execution cycle for CR1. It is about a 20-line change and one test. Preferred.
   - (b) Merge as is and file a follow-up for the late-request editor unmount. The branch is still a strict improvement over base: no stale cards, and no cross-pipeline PATCH on the common path. In that case, record the residual race in the PR body.
