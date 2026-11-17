## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 9383a6092974e9a5ac4b898c9202d0dea53f14f8. The diff base was resolved live by `resolve-review-base.sh`: 46ab3251e0677951520fe948f21bc9f716fc9369 (2 commits, frontend and e2e only, no backend or schema change).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/draft-structural-operations/HEL-1684`.
Scope is the owner ruling `split-as-proposed`: add, insert, duplicate, "+ lane" and trunk reorder are drafted. Roots (HEL-1734), Outputs and shapes (HEL-1733) stay blocked.

### What I verified (with evidence)

**Fresh gate runs (mine)**
- Jest, maxWorkers 3, `draftOps|pipelineDraft|keptDraft|draftSelection|draftPreviewRequest|usePipelineDraft|draftMode`: **10 suites, 103 tests passed**.
- e2e on the pinned ports (`DEV_PORT=7116 BACKEND_PORT=10023`, `--workers=2`, `nice -n 19`), `hel1684-draft-structural` plus `hel1631-draft-mode`: **`36 passed (4.2m)`, EXIT=0**.
- `assert-phase.sh servers` gave `PASS servers`.
- Red-first evidence (`evidence/red-run.txt`) shows `25 failed, 1 passed` on the unchanged code. The one test that passed is the `[guard]` v1-restore test, which is labelled as a guard. `evidence/guard-mutation.txt` shows that test failing under a named mutation.
- `evidence/mutations-cycle2.txt` has two recorded reds:
  - the `post()` refusal: Expected 0 / Received 1;
  - lane vs insert told apart by the save body: `position >= 1`, Received 0.

**Design-gate round-3 notes (tasks.md section 7)**
- **7.1, append detection uses the draft lane: honoured.**
  - `usePipelineDetailPage.ts`, `handleInsertStep` draft branch: `computeInsertAnchor(draftSteps, roots, index)`. It never compares against `stepsRef.current.length`.
  - Append is chosen only by the caller: `handleAddStep` → `{append: rootId}`, and "Insert step after" on the last lane step → palette `append`.
  - **Live probe:**
    - Draft trunk: Filter, Limit*, Sort, Compute, Limit*, Sort* (* = new). The saved steps number 4, so the old `isAppend` test would have fired at gap index 5.
    - I used "Insert step after" on the second new Limit, which is not the last card.
    - Dedupe landed between that Limit and the new Sort, not at the end. The spine read `Step 5: Limit rows`, `Step 6: Dedupe rows`, `Step 7: Sort rows`.
- **7.2, the reorder filter is applied before the move: honoured.**
  - `handleReorderSteps` takes `before = liveTrunkIds(draftSteps, root.id)` before the move.
  - It then calls `trunkAfterMove(newOrder, root.id, before)`. That function walks `reorderLane`'s output, reports only ids in `before`, and hops over a temp step.
  - `liveTrunkIds` is never called on the moved output.
  - Unit tests in `draftOps.test.ts` "a temp (step-N) step in the draft (D1a)":
    - moving a saved step across the swept temp step records `[a, c, b]` without the temp id, and that order survives replay over a base with no temp step;
    - a temp step relinked into the middle of the chain is hopped over.
  - Live: Move up on a new step recorded a `reorder` op. The kept sessionStorage ops read `[insert, lane, insert, insert, insert, reorder]`.
- **7.3, the restore does not prune while stale: honoured.**
  - `usePipelineDraft.ts` restore calls `setOverlay(kept.overlay)` and no longer calls `rebaseOverlay`.
  - The dropped-op effect returns early while `staleRestoredRef.current` is set.
  - Every edit path threads `keepOps = staleRestoredRef.current` into `pruneOverlay`.
  - `usePipelineDraft.dropped.test.tsx` covers it: a stale-restored draft keeps its ops, and `rebase` then reports 1. An edit while stale does not drop them.
  - The e2e "kept draft with a new step over a base that changed is restored as stale; Reload keeps the step" passed in my run.
- **7.4** is a PR-body item. I cannot verify it until the PR exists, so the orchestrator should carry it.

**Acceptance criteria traced**
- **AC1: each action works inside a draft and is saved atomically on Save & run, or thrown away on Discard.**
  - Routing is `usePipelineDetailPage.ts` (5 latest-callbacks gated on `draft.hasDraft`), backed by the op appliers in `draftOps.ts`. Each applier mirrors a server primitive: the splice, `attachTailInternalAction` and `reorderTrunkAction`.
  - Controls are re-enabled in `PipelineSpine.tsx`, `useSpineStepActions.tsx` and `StepCardFocused.tsx`.
  - Live, phone light, my own seeded pipeline: filter edit, Duplicate on a saved Sort, then "Branch from here" on the new duplicate, then Save & run.
    - The network log shows **exactly one** `POST .../draft/save` and no step write.
    - The saved tree read back from `GET /steps`:
      - the dup sort sits under the original at position 0;
      - Compute was re-parented to the dup;
      - the lane Limit sits under the dup at position 1 (parentClientId resolved by the server);
      - `?step=` moved to the saved lane Limit's real id `2da60883…` (D6).
  - Discard, live, phone dark: the spine went back to the saved 4 rows with no draft.
  - The e2e covers every action × save/discard with request recording. `stepWrites` must be `[]` and the body is checked per op.
- **AC2: kept-draft restore and the stale-base path still work.**
  - The e2e Back/Forward restore, v1-format `[guard]` restore, stale-with-new-step plus Reload, and Undo tests all passed in my run.
  - `keptDraft.ts` parses v2 op by op, and a v1 kept draft maps `deleted[]` to delete ops.
- **AC3: desktop and phone, light and dark, with e2e per action that fails first.**
  - `describeMode` covers desktop light (all 7 actions plus Discard) and phone dark (6; drag is desktop only). Desktop dark and phone light each get an insert smoke.
  - The red run is on file.
  - The live visual check below covers all four pairs.

**Iron laws**
- This is a feature, not a bug fix, so no root-cause record applies.
- Guard tests are labelled as guards and each has a recorded mutation red.

**UI and design judgment** (running app on 7116/10023; `DESIGN.md` binding; the diff touches no CSS or tokens)
- **Desktop light, menu during a draft** (`/home/matt/Development/helio/.concertino/runs/HEL-1684/evidence/.playwright-mcp/skeptic-final-1/s1-desktop-light-menu.png`):
  - Move down, Insert before/after and Branch are enabled.
  - "Add output" and "+ Add source" stay greyed with the reason.
  - The disabled styling matches the existing menu treatment.
- **Desktop light after insert and lane** (`.../s2-desktop-light-insert-lane.png`):
  - New steps show only the draft count ("8"); saved steps show "14 → 8" (D9).
  - The saved tail (Rename) visibly moves under the inserted step ("Lane 1 · from 2 Limit rows"), as the server's splice does.
  - Lane indentation, rhythm and the selected-row tint are consistent with sibling rows.
- **Desktop dark** (`.../s3-desktop-dark-draft.png`): insert, lane and duplicate in one draft. The draft pill, Discard and Save & run, and the selected row all read correctly in dark, with no contrast regression.
- **Phone dark**:
  - `.../s4-phone-dark-menu.png`: the sheet's "Step actions" menu is enabled and Add output stays disabled.
  - `.../s6-phone-dark-spine.png`: after a head insert, the floating Discard/Save bar is consistent.
  - I checked whether the bar hides "+ Add step" at the end of the list. After scrolling `.mobile-body` to its end, a hit-test at the button's centre returns "+ Add step", so it is reachable.
- **Phone light** (`.../s8-phone-light-dup.png`, `.../s9-phone-light-spine.png`): duplicate, then a lane under the new step. The structure renders cleanly and the draft bar sits correctly.
- No new console errors. The only error is a pre-existing `401 /api/auth/me` on the login page, before sign-in.

**Cleanup:** I removed my live-probe residue by exact id. Pipeline `c39f6574-e0b6-44d0-a8f5-44ef9e471dca` and source `e79e37ed-c5a5-4ccf-9bae-508f70fe5900` both returned DELETE 204. The e2e deleted its 36 throwaway users.

### Verdict: CONFIRM

### Non-blocking notes
- **7.1's test does not exercise the routing.** `draftOps.test.ts` "with two new steps already in the draft, an insert at the last gap is NOT an append" hands the applier a precomputed `{after: "draft-1"}` anchor. It would still pass if `handleInsertStep`'s draft branch regressed to `stepsRef`. The code is correct, and I confirmed it live, but a component-level test through `handleInsertStep` with two new steps would lock it in.
- **`trunkAfterMove` with a temp step dragged to the head.** If a temp step becomes the lane head, `head` is undefined and the recorded trunk is `[]`. The length guard in `handleReorderSteps` then silently ignores that reorder. This is a no-op, not corruption, but the user gets no feedback.
- **Carry these to the PR body:**
  - 7.4: a pending AI step's deferred create drops a reorder;
  - the incomplete-config duplicate 400;
  - the HEL-1704 file-split deferral (`usePipelineDetailPage.ts` and `usePipelineDraftSave.ts` are over the CONTRIBUTING soft budget).
- **The preview table drops type hints for a new step.** On a draft-new step it shows column names without the `string`/`float` type hints that saved steps show (`s5`/`s8`). This is cosmetic and comes from the draft frame having no saved schema.
- **The browser harness cannot get past `beforeunload` with an open draft.** A hard reload or page change shows a dialog the MCP tool cannot accept. That is intended app behaviour, so future live checks should Discard before reloading.
