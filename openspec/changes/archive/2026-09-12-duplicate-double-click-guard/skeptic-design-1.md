## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD a2ae646ebb9420e239740c70de9be4a7dbc0e7e0.

### What I verified (with evidence)
- assert-cwd.sh: READY.
- Call-site shapes (design.md Context) match the live tree: PanelCard.tsx:227-230 `useCallback(() => void dispatch(duplicatePanel(...)))`; DashboardList.tsx:143-150 async fn awaiting `.unwrap()` with try/catch, wired at :405; usePipelineDetailPage.ts:1169-1187 async useCallback awaiting `duplicatePipelineStep` + `syncStepsFromServer`, catching internally.
- ActionsMenuItem.disabled exists (ActionsMenu.tsx:10, :37, :138). BUT `handleItemClick` (ActionsMenu.tsx:73-76) calls `close()` BEFORE `item.onClick()`: the menu (and the clicked item) unmounts on the first activation.
- StepCard is `React.memo` (StepCard.tsx:111) and is rendered NOT by PipelineDetailPage but by PipelineRiverView.tsx:399 (`onDuplicate={onDuplicateStep}` :416), LaneColumn.tsx:175/:218, with pass-through props in RootColumn.tsx:32/108 and PipelineRiverView.tsx:98/469/546.
- Hook design (ref Set checked synchronously before any await) does close the same-tick race in principle; rationale is sound.
- Delta specs: all three MODIFIED blocks preserve the original requirement text verbatim (compared with openspec/specs/{dashboard-duplication,panel-duplication,pipeline-step-lifecycle}/spec.md) and only append guard sentences + two scenarios. No invented requirement.
- Scope: grep of `duplicat` over frontend/src (non-test) finds only these three affordances (patchSets/commandPalette hits are unrelated). Scope correct.
- Test files: PanelCard.test.tsx, DashboardList.test.tsx, StepCard.test.tsx, PipelineDetailPage.test.tsx exist; usePipelineDetailPage.test.ts does NOT exist.

### Verdict: REFUTE

### Change Requests
1. **Prop-threading path is wrong (design.md Decision 3, tasks.md 1.4).** StepCard is not rendered by PipelineDetailPage; the pending signal must be threaded PipelineDetailPage -> PipelineRiverView -> (StepCard at :399 | RootColumn -> LaneColumn -> StepCard at :175/:218). Name every file in Impact/tasks, and pick ONE shape. Decision 3 says `disabled={isDuplicating}` boolean; task 1.4 says "`duplicatingStepId`/`isPending(stepId)`". Resolve: pass a per-card boolean (e.g. `isDuplicating={pendingIds.has(step.id)}`) or a stable `ReadonlySet`, never an `isPending` function whose identity changes each render — that would defeat StepCard's `React.memo` (the F-146 invariant documented at PipelineDetailPage.tsx:274-279). State this memo constraint explicitly.
2. **Menu-surface tests as specified can pass vacuously (tasks 2.2, 2.3).** Because ActionsMenu closes before calling `onClick`, a second `fireEvent.click`/`userEvent.dblClick` on the same menu item hits an unmounted node and dispatches nothing even with NO guard. Tasks must require a test that is red without the guard: e.g. hold the duplicate request pending (unresolved promise), reopen the menu, activate "Duplicate" again, assert exactly one request; then settle (resolve, and separately reject), reopen, assert enabled and a second activation issues a new request. Require the executor to demonstrate red-without-guard (mutation) for each surface.
3. **Rejection semantics of `guardedRun` are unspecified (Decision 1).** `fn().finally(...)` re-propagates rejection; with a `void` return that is an unhandled rejection (Jest failure in task 2.1's "rejected promise" case). Also a synchronous throw from `fn` would skip `.finally` and leave the key permanently locked. Specify: wrap in try/`Promise.resolve().then(fn)` (or equivalent) so sync throws release the key, and state whether `guardedRun` returns the promise or swallows rejection (callers today all handle their own errors).
4. **Task 2.4 target is ambiguous and one option is useless.** `usePipelineDetailPage.test.ts` does not exist, and StepCard.test.tsx mocks `onDuplicate`, so a double-activation test there never exercises the guard (which lives in the hook). Specify PipelineDetailPage.test.tsx (or a new hook test) with the duplicate service mocked pending, plus a StepCard.test.tsx assertion only for the `disabled` rendering.
5. **PanelCard wiring detail (task 1.2).** Current `handleDuplicate` returns `void`; state that it must return the dispatch promise to `guardedRun` (thunk promise resolves on rejection too — fine, but spell out that failure clears via settled thunk, not a throw), and keep `useCallback` deps stable.

### Non-blocking notes
- DESIGN.md: a disabled menu item/icon button should use the existing disabled styling; no new visual state needed.
- Hung-request risk acknowledged in design; acceptable.
