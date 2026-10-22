## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9 (branch bug/draft-mode-polish/HEL-1685, change dir untracked).
Paths are relative to `frontend/src/features/pipelines` unless stated otherwise.

### What I verified (with evidence)

- **Owner triage matches the artifacts.** I read `.concertino/runs/HEL-1685/events.jsonl`. Line 9 records `escalation.answered`
  (id HEL-1685-1792681541852-95d9a1, answer_source human) with sub_answers `decline-record-measurement`,
  `pipeline-page-only`, `defer-followup` (13), `keep-defer-followup` (D), `defer-followup` (E), `defer-followup` (H).
  Line 2 records `add-carveout` for DESIGN.md §10. The proposal's Non-goals match these answers. No shipped item goes
  beyond the triage: D8 is limited to the three pipeline-page dialogs, and the shared `Modal` is untouched.
- **(a) D8, selectors inside the dialogs.** `PipelineShareDialog.tsx`, `ui/schedule/PipelineScheduleDialog.tsx` (it uses
  only `useAppDispatch`, which is stable) and `StepPalette.tsx` have no `useAppSelector` or context hooks. So memo can
  work for them. **But StepPalette's `onSelect` cannot become stable as designed.** In `ui/spine/useSpineStepActions.tsx`,
  `handlePaletteSelect` closes over `onInsertStep` and `onAddLaneStep`. Both layouts pass those as new inline arrows on
  every render (`ui/spine/PipelineSpineLayout.tsx:69-70`, `ui/mobile/PipelineMobileLayout.tsx:61-62`). A `useCallback`
  over those dependencies changes on every render, so `React.memo(StepPalette)` does nothing. See CR2.
- **(b) D5, the walker's reuse contract.** `state/draftEvaluation.ts:70-97`: reuse is decided by reference equality on
  `rootFrames`/`sources` plus `singleEditedStep`. Lifting the walker instance does not change that. The page content
  remounts per pipeline (`ui/PipelineDetailPage.tsx:33` `key={id}`), so a lifted instance never crosses pipelines. I
  found no reason it would affect HEL-1691 latency: the same identities and the same number of walks. However:
  - `state/draftStepView.ts:174-178`: the tracker seeds `good` from the **saved** (base) walk. On main, a fresh tracker
    after the swap therefore shows the saved frame as "last good". A test whose last good draft count equals the saved
    count passes on main. See CR4.
  - `hooks/usePipelineDraftFrames.ts`: `useDraftPreviewTransport` is also per-layout state. Server-resolved frames are
    lost on the swap even with a lifted tracker, but the spec delta says "not a pending state" for every step. See CR4.
- **(c) D3, the 401 path.** `services/httpClient.ts:24-47` and `features/auth/state/authSlice.ts:60-73,150-163`. The repo
  already has one place that clears state when a session ends: a listener on `clearAuth`
  (`features/dashboards/tabs/warm/warmListeners.ts:204-211`, "logout AND the 401 sign-out both dispatch `clearAuth`").
  D3 picks the interceptor instead, and it justifies skipping rehydrate failure with "a draft kept from a session that
  expired before reload is still cleared by the first 401 after sign-in". That is false. After a new sign-in the
  session is valid, so no 401 comes. This is the spec's own scenario ("the next user who signs in does not see it"),
  and it is left uncovered. See CR1.
- **(d) D11, the cap.** `hooks/useIdleCoalesced.ts`. Once the cap is reached, `wait` is 0, the timer queues
  `requestIdleCallback`, and the next change's cleanup calls `cancelIdleCallback`. The diagnosis is right, and calling
  `setShown` directly after the cap is a correct fix. The fake-timer test with an idle callback that never fires is a
  real red.
- **(d) D10, the settling flag.** `ui/liveOutput/LiveOutputColumn.tsx:57-63`: `fresh = useMemo({page, presentation,
  selectedStepId})`. `page` is the object literal returned by `usePipelineDetailPage` (`hooks/usePipelineDetailPage.ts`,
  return block, about 80 fields), so it is a new object on every page render. Defining "settling" as "the uncoalesced
  value differs from the shown one" would show "updating" after any page render: a run-status tick, a dialog toggle,
  `dropdownOpenAt`. The spec says "updating" only while a newer draft frame for the Output's node is unrendered. See CR3.
- **D9, the cascade hints.** `backend/.../draft/DraftSaveTransaction.scala:107-110` emits exactly four hints: steps,
  Outputs, bound panels and alert rules. `ui/PipelineDraftDialogs.tsx:48-71` already lists all four. D9 keeps the
  panel and rule hints ("keeps any other hint"), so two redundant "(s)" lines remain, and it does not say how to tell a
  "restating" hint apart. See CR5.
- **D6.** `hooks/useStepCardEditorState.ts:117-118` declares `setSaveError` and `setSaveErrorIsValidation`, and nothing
  calls them (grep finds no call site outside OutputEditorSheet's own, unrelated state). The plumbing is dead, as
  claimed.
- **D1.** `ui/spine/PipelineSpineLayout.css:5` declares 3 rows. With a notice, `.spine-strip-slot` takes the
  `minmax(0,1fr)` row and `.spine-body` falls into an implicit row. That is the band. The 4-row and slot fix is correct.
  The e2e is a real red.
- **D4.** `hooks/usePipelineOutputSheets.ts:36-38` updates `allOutputsRef` in a layout effect. The window D4 needs is
  plausible but unproven, and the design correctly requires a probe first, with a "not reproducible" exit.
- **D7.** `hooks/useStepSelection.ts:58-71`: the diagnosis is right, and the base → base−s2 → base test is a real red.
- **D15.** `theme/elevationTokenGuard.css.test.ts:410` and `theme/motionTokenGuard.css.test.ts:173` contain
  `toBe(151)`, confirmed. No other guard hardcodes the count.
- **D13.** `features/panels/ui/referenceMarksOption.ts:91` sets `animation = !prefersReducedMotion()`. ChartPanel's
  `noAnimation` (`ChartPanel.tsx:125-132`) overrides only the top level. Confirmed.
- **D16.** Archived `design.md:174` (the stale "Open" line and `test.fixme`) and `:176` (baseSignature without a
  reason) confirmed. `state/pipelineDraft.ts:283-296` confirms that Outputs are compared in `definitionMatchesBase`,
  not in `baseSignature`. Item 14: `PipelineScheduleDialog.rerender.test.tsx:31`, confirmed.
- The spec delta's MODIFIED header "Caption, live marker and stale states" matches `openspec/specs/pipeline-live-output-column/spec.md:41`.

### Verdict: REFUTE

### Change Requests

1. **D3: the premise is false and the spec scenario is not covered.** Remove the sentence "still cleared by the first
   401 after sign-in". Then choose one approach and justify it:
   - (a) Clear kept drafts in a `clearAuth` listener, the established single place (`warmListeners.ts:204-211`). This
     covers logout, a 401 and rehydrate failure. State the trade-off: `rehydrateAuth` catches every error, so a network
     blip at load would also drop the drafts.
   - (b) Keep the interceptor, and also clear on the sign-in that follows an unauthenticated rehydrate (for example,
     clear on `setAuth` when the previous status was `unauthenticated`).
   - (c) Narrow the spec scenario so it no longer promises "the next user who signs in does not see it" when the
     session expired before a reload.

   Whichever you choose, add a test for the expire → reload → new sign-in sequence, or an explicit statement that it is
   out of scope.
2. **D8: StepPalette's props cannot be stable as written.** `handlePaletteSelect` (`ui/spine/useSpineStepActions.tsx:191`)
   depends on `onInsertStep` and `onAddLaneStep`, which are new inline arrows every render in
   `PipelineSpineLayout.tsx:69-70` and `PipelineMobileLayout.tsx:61-62`. Specify the mechanism: a latest-ref handler in
   `useSpineStepActions` (a stable callback that reads `palette` and the handlers from refs), or stabilising those
   arrows in both layouts. Do the same for Share and Schedule's `onClose` (`ui/PipelineDetailDialogs.tsx:58,68`, inline
   arrows today). Require the render-count test to drive the **real** composition: `PipelineSpineLayout` and
   `PipelineMobileLayout`, or the page, with a draft edit. A parent re-rendered with identical props passes on main and
   proves nothing.
3. **D10: define "settling" on the Output's node frame, not on the identity of the coalesced object.** `page` is a new
   object on every page render, so `fresh !== shown` is true after any unrelated render, and "updating" would flicker
   on run-status ticks and dialog toggles. Define it as "the node's view in `fresh.presentation.frames.views` for the
   shown Output's `nodeStepId` (or its rows) differs from the shown one". Add a test that an unrelated page re-render
   (for example, toggling `shareOpen`) does not show "updating".
4. **D5: make the test non-vacuous and resolve server-resolved steps.**
   - (a) The RTL test must have a last good **draft** count that differs from the **saved** count for the step at and
     above the error. On main, a fresh tracker seeds from the base walk (`state/draftStepView.ts:174-178`), so equal
     counts pass on main.
   - (b) The transport (`useDraftPreviewTransport`) is still per-layout, so server-resolved steps go pending after the
     swap, contradicting the spec delta's "not a pending state". Either lift the transport's results as well, or
     narrow the requirement and scenario to client-evaluated steps and say so in D5.
5. **D9: the cascade hints.** All four backend hints (`DraftSaveTransaction.scala:107-110`) restate rows the dialog
   already lists (`PipelineDraftDialogs.tsx:48-64`). Specify that the dialog stops rendering `impact.hints`, because
   every hint the server can produce is already listed. Or, if some hints must stay, name the exact matching rule. Do
   not keep the panel and rule "(s)" lines, which is what "keeps any other hint" does today. Update the test to match.
6. **Deferred items need a follow-up task.** The owner's options read "file the shared-Modal change as a follow-up" and
   "defer to a follow-up". `tasks.md` has no task to file follow-up tickets for item 13, addendum D, E and H, or the
   shared `Modal`, or to record each deferral's reason in `evidence.md`. The AC requires each item to be "deferred with
   a reason". Add that task, and say where each deferral and its reason is recorded.

### Non-blocking notes

- Item 9 (D6) will have a guard rather than a red for the notice path. That is honest, but the AC says "bugs 4–10 each
  get a test that fails first". Name it a decision in the PR body. The grep/type check that no `saveError` prop remains
  is the red.
- D2's e2e should say where it scrolls (the last Output card at scroll end). A fixed bottom bar always overlaps content
  in the middle of a scroll, so an unqualified non-intersection assert is ambiguous.
- D13: say where `noAnimation` is applied. Threading it through `useChartOption → buildChartOption →
  applyReferenceMarks` is one way. Post-processing `markLine`/`markArea` in ChartPanel's `noAnimation` memo is another.
  Check that the HEL-1584 shape signature is unaffected.
- D5 adds state to `usePipelineDetailPage.ts`, which is already 507 lines. The owner deferred the split (item 13), so
  keep the addition minimal.
- D11's test relies on jest's modern fake timers faking `performance.now`. Confirm the pending timestamp actually
  advances in the test.
- D6: a per-step save-error seam already exists (`stepSaveErrors` in `useStepSaveSeam`, rendered through
  `SpineStepRow.savedError`). The "not cheap" reason for not routing should acknowledge it.
