## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9 (branch bug/draft-mode-polish/HEL-1685; the change dir is untracked).
Paths are relative to `frontend/src/features/pipelines` unless stated otherwise.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/draft-mode-polish/HEL-1685`.
- **Owner answers, from the run log itself** (`/home/matt/Development/helio/.concertino/runs/HEL-1685/events.jsonl`):
  - Line 2: `escalation.answered`, `add-carveout`, answer_source human, escalation HEL-1685-1792681019556-b440ce.
  - Line 5: six sub-questions (perf 1+2, item 3, item 13, addendum D, E, H).
  - Line 9: `escalation.answered` for HEL-1685-1792681541852-95d9a1, answer_source human, with `[decline-record-measurement, pipeline-page-only, defer-followup, keep-defer-followup, defer-followup, defer-followup]`.
  - Line 6 is an `escalation.answer_discarded` 8 ms after the raise. That is a stale-answer discard, not an answer, and line 9 supersedes it.
  - `workflow-state.md` RESOLVED_ESCALATIONS matches these lines. The proposal's Non-goals and D17 match the answers.
- **Coverage.** Every ticket item is shipped or decided:
  - 1–2: declined (D16/D17)
  - 3: D8
  - 4–10: D1–D7
  - 11: D9
  - 12 and 14: D16
  - 13: deferred
  - A: D10
  - B: D11
  - C: D12
  - D, E, H: deferred
  - F: D13
  - G: D14
  - I: D15
  - J: no action
- **Round-1 CR1 (D3): resolved.** `services/httpClient.ts:24-47`: the 401 interceptor dispatches `auth/clearAuth`, except for `/api/auth/me` and `/api/auth/mfa`. `features/auth/state/authSlice.ts:65-74`: `rehydrateAuth` dispatches `clearAuth()` in its catch. So a `clearAuth` listener covers logout, a 401, and an expired session followed by a reload.
  - The false "first 401 after sign-in" sentence is gone.
  - The cost of a network failure at load is stated.
  - The existing `clearAuth` listener at `features/dashboards/tabs/warm/warmListeners.ts:204-211` and `store/store.ts` `startAppListening` confirm the pattern.
  - The red on main is real: `clearKeptDrafts` is only called from the logout thunk (`authSlice.ts:158`).
  - The spec gained the "Session expired before a reload" scenario.
- **Round-1 CR2 (D8): only partly resolved.**
  - `useLatestCallback` is safe for `StepPalette.onSelect`. `StepPalette.tsx` calls `onSelect` only from `selectRow` (click/Enter handlers), never during render or in a layout effect. `handlePaletteSelect` reads `palette` from the latest committed closure, which is correct.
  - `useLatestCallback` is also safe for Modal `onClose`. `shared/ui/Modal.tsx` uses `onClose` only in the `cancel` listener effect (`[onClose]` dependencies, :171-180) and the backdrop click (:225). A stable identity is strictly better there.
  - The other dialog props are stable across a draft edit: `pipelineName` is a string, and `pipelineSchedule` is a plain `useAppSelector` slice read (`hooks/usePipelineAnalyzeState.ts:34-36`).
  - **However, D8's list of unstable props is incomplete.** See CR1.
- **Round-1 CR3 (D10): the comparison is stable, but its placement is unspecified.** In `hooks/usePipelineDraftFrames.ts`, `views` is memoised on `[tracker, draftWalk, baseWalk, transport, sampleLoading]`. `draftWalk` is memoised on defs, rootFrames and sources, and `selectRootFrames` and `selectSourceFrames` are `createSelector`s. On an unrelated page render (a dialog toggle) none of those change, so the node's `view.rows` reference and `view.status` are identical. The frame comparison therefore does not flicker on unrelated renders. But see CR3: the design does not say where the comparison runs relative to the memoised `LiveOutputColumnView`.
- **Round-1 CR4 (D5): (b) resolved, (a) not fully resolved.** The spec is narrowed to client-evaluated steps, and the transport re-request is stated. In `state/draftStepView.ts`, `mapStepView` returns `node.rows`/`node.count` for any `ok` node, so a step **above** the error always shows its current draft count, even with a fresh tracker on main. Only the errored step (and steps below it) shows `stale(lastGood)`, which a fresh tracker seeds from the saved walk (:174-178). D5's test text asserts "the phone shows the draft's last-good 3", where 3 is **step 1's** draft count, and step 1 is not in error. Read literally, that assertion is green on main. See CR2.
- **Round-1 CR5 (D9): resolved.** The dialog stops rendering `impact.hints`; `ui/PipelineDraftDialogs.tsx:67` is the only render site.
- **Round-1 CR6 (D17): resolved, under a different mechanism.** D17 records every deferral and its owner answer in `evidence.md` and the PR body, and the driver files the follow-ups. Task 3.4 carries it.
- **C1** is present in `tasks.md` ## Standing Constraints and in `workflow-state.md` CONSTRAINTS.

### Verdict: REFUTE

### Change Requests

1. **D8: StepPalette's `onClose` is also an inline arrow, and D8 does not list it.**
   - `ui/spine/useSpineStepActions.tsx:207` passes `onClose={() => setPalette(null)}`, a new function every render.
   - D8 says "The unstable props today are the inline `onClose` arrows (`PipelineDetailDialogs.tsx:58,68`) and `StepPalette`'s `onSelect`", and applies `useLatestCallback` to "those three handlers". Done as written, `memo(StepPalette)` is still defeated on every layout render.
   - Required: name all four handlers (Share `onClose`, Schedule `onClose`, StepPalette `onSelect` and StepPalette `onClose`), or say that every function prop of the three memoised dialogs goes through `useLatestCallback`.
   - Make task 2.1 match.
2. **D5: say which step the red assertion is on.** It must be the **errored** step, or a step below it, whose last good **draft** count differs from its saved count. For example: edit 1 makes step 2's count 3 (saved 5), edit 2 puts step 2 in error, flip to phone, and assert that **step 2** shows 3.
   - A step above the error is recomputed by the fresh walk on main, so it cannot go red.
   - Also say whether the rows (not only the count) of the errored step are asserted, because the spec says "counts and rows".
   - C1 would catch a vacuous test at execution time. But round-1 CR4(a) asked for this design-level fix, and the current example invites the vacuous version.
3. **D10: state where "settling" is computed, and keep the live view out of the per-edit path.**
   - `LiveOutputColumnView` is `memo`'d and receives only the coalesced bundle, by design. Its comment at `ui/liveOutput/LiveOutputColumn.tsx:140-141` says "This view itself is re-rendered only at an idle moment per edit". HEL-1632 built it that way.
   - The displayed Output (and so its `nodeStepId`) is decided **inside** the view, from its `pick` state (:94-103). The fresh presentation exists only in the outer `LiveOutputColumn`.
   - The obvious implementation is to pass the fresh presentation into the view so it can compare. That re-renders the view (source resolution, hooks) on every edit, which undoes the coalescing and puts the column back on the edit hot path.
   - Required: specify that the comparison runs in the outer `LiveOutputColumn` and reaches the view as a boolean `settling` prop. The view should then re-render only when the boolean flips, not once per edit. Also say how the outer component knows the displayed node: lift `pick` or the output resolution to the outer component, or another named mechanism.
   - Add D10 to the "touch the edit hot path" risk, alongside D5/D8 (local `@prod-build` latency e2e).
   - Optionally, add a render-count assertion on the view during a burst of edits.

### Non-blocking notes

- D10 edge case: if a run's completion refetches the pipeline and `roots` changes identity, `selectRootFrames` recomputes, `sampleFrame` may yield new frames, and a full re-walk gives new `rows` references. That would show "updating" for one settle window after a run. Check this during the browser pass. The spec's "a run status changes" scenario covers it.
- D8's test renders `PipelineSpineLayout` and `PipelineDetailDialogs` side by side. Share and Schedule live in `PipelineDetailDialogs`, which takes `page`, a new object on every page render. Make sure the test re-renders through a real `usePipelineDetailPage` (or the page), not a hand-built `page` prop.
- Round-1 notes on D2 (where the e2e scrolls), D13 (where `noAnimation` is threaded), D11 (`performance.now` under fake timers) and D6 (the existing `stepSaveErrors` seam) are not reflected in the text. They are still non-blocking.
