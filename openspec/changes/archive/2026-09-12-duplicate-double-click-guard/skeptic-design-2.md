## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD a2ae646ebb9420e239740c70de9be4a7dbc0e7e0. Spawn-cwd guard: READY.

### What I verified (with evidence)
- Round-1 CR3 (guardedRun contract): resolved. Decision 1 now specifies `.catch(() => {}).finally(...)`, a `void` return, and that each `fn` handles its own errors. That matches the live handlers: DashboardList.tsx:143-150 uses try/catch around `.unwrap()`, and usePipelineDetailPage.ts:1170-1185 uses try/catch plus a toast.
- Round-1 CR5 (PanelCard `void`): resolved. PanelCard.tsx:227-230 is `() => void dispatch(duplicatePanel(...))`, and Decision 2 and task 1.2 drop the `void`.
- ActionsMenu close-before-onClick: confirmed. ActionsMenu.tsx `handleItemClick` calls `close()` and then `item.onClick()`. `ActionsMenuItem.disabled` exists and is wired to `disabled=` and `enabledIndices`.
- Round-1 CR4 (test file): partly resolved. PipelineDetailPage.test.tsx exists and mocks `duplicatePipelineStep` (lines 35, 52, 71), so the guard can be reached through the real hook. PanelCard.test.tsx and DashboardList.test.tsx exist. DashboardList.test.tsx already mocks `duplicateDashboard`. PanelCard.test.tsx does not mock a panel duplicate service yet, which the implementer can add.
- `frontend/src/hooks/` placement: allowed by hooks/README.md, because the hook is used by 3 feature dirs.
- StepCard wiring (round-1 CR1): **only partly correct**. See CR1 and CR2 below.
  - `grep -n "<StepCard"` finds exactly three render sites: PipelineRiverView.tsx:399, LaneColumn.tsx:175 and LaneColumn.tsx:218.
  - RootColumn.tsx has no `<StepCard`. Lines 95-118 render `<LaneColumn ... onDuplicateStep={onDuplicateStep} />`.
  - `onDuplicateStep` is forwarded at PipelineRiverView.tsx:469 and 546, and at LaneColumn.tsx:137.
  - StepCard is `React.memo` (StepCard.tsx:111), so the design's choice of a boolean prop over a function prop is sound.

### Verdict: REFUTE

### Change Requests
1. **Decision 3 and task 1.5 say RootColumn renders a StepCard. It does not.** Both claim "four `<StepCard onDuplicate=.../>` call sites ... and `RootColumn.tsx`'s own render". RootColumn.tsx:95-118 renders `LaneColumn`, not `StepCard`. The real render sites are three: PipelineRiverView.tsx:399, LaneColumn.tsx:175 and LaneColumn.tsx:218. RootColumn only forwards the set to LaneColumn, and PipelineRiverView.tsx:546 forwards it to RootColumn. This is the same class of error round 1 refuted. Please fix it so the implementer does not go looking for a fourth site or add a stray prop.
2. **The new StepCard prop name `disabled` is ambiguous in this component.**
   - StepCard already carries step-level "disabled" meaning: the enable/disable toggle (`step.enabled`), and the spec line "Disabled cards SHALL render visually muted".
   - A `disabled` prop on StepCard can be read two ways: disable or mute the whole card, or disable only the duplicate button.
   - The design never says what StepCard does with the prop.
   - Required: give the prop an unambiguous name (e.g. `isDuplicating`). State that it only sets `disabled` on the "Duplicate step" `<button>` (StepCard.tsx ~282-290), and that it does not touch muting, the toggle or other controls.
   - Also update the Risks section, which still says `isDuplicating`/`disabled` and "through `PipelineDetailPage.tsx`".
3. **Task 2.2's double-activation test contradicts Decision 3 and likely passes without the guard.**
   - Task 2.2 says to click "Duplicate" twice "in the same tick (before the menu-close from the first click completes)".
   - Decision 3 itself says a real double-activation on an ActionsMenu surface is "activate, the menu closes, reopen the menu, activate again".
   - Task 2.3 says to reopen the menu, and says it is "the same shape as 2.2". So the two tasks disagree.
   - Why it likely passes without the guard: a click is a discrete React event, so the `close()` update is flushed when the handler ends. The menu item is then unmounted, and a second `fireEvent.click` on the detached node does nothing. That is round-1 CR2 again.
   - Required: rewrite 2.2 to match 2.3 and Decision 3. First activation with the request held pending, then reopen the menu, then activate "Duplicate" again. That second activation needs a real test path around the guard: either click before the `disabled` state commits, or call the item's handler directly, so the ref guard, not just the `disabled` attribute, is what blocks it. Assert exactly one dispatch.
   - Keep the red-without-guard check for 2.2 and 2.3, and state it explicitly in 2.3 rather than only through "same shape".

### Non-blocking notes
- Task 2.4 still hedges "(or a dedicated `usePipelineDetailPage.test.ts` ...)". That's fine as long as the file is created, but PipelineDetailPage.test.tsx is the verified, reachable location. Prefer it.
- In StepCard, the `disabled` attribute blocks a second activation once the re-render commits, but only the ref guard in `usePipelineDetailPage` covers the same-tick case. Test 2.4 should therefore also cover the case where the button's `disabled` attribute does not block the second call, e.g. two synchronous `onDuplicateStep` calls. Otherwise AC4 is only proven at the hook-unit level (2.1).
