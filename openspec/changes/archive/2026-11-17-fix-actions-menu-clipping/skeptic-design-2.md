## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/actions-menu-viewport-clipping/hel-1750`. HEAD is 2e98eba9287d61a47957129f1f097ea039125d92. The only untracked path is the change dir; there is no implementation yet.

- **Round-1 CR1 (`align="above"` test contradiction): addressed.**
  - D2a keeps the anchoring contract: `top` when the menu opens below, `bottom` when it opens above. D2 adds a no-layout rule: natural height 0 gives the preferred side, uncapped.
  - I traced this through jsdom. Rects are zero, and with Select's measurement (`scrollHeight` + `offsetHeight - clientHeight`) the natural height is 0.
    - For `align="above"` this yields a `bottom` anchor with `top` undefined.
    - For the default it yields `top` with `bottom` undefined.
  - So `ActionsMenu.test.tsx:139-156` holds unmodified. D2a and task 2.4 forbid editing it.
  - **Without** the no-layout rule, `prefer: "above"` with zero rects gives room above = -16 and room below = 752, so the menu would flip below and the test would go red. The no-layout rule is therefore load-bearing. See note 1.

- **Round-1 CR3 (hidden-until-placed has no task): addressed.**
  - Task 2.3 now renders `visibility: placed ? undefined : "hidden"` and `maxHeight` inline.
  - Task 2.4 adds a unit assertion.
  - D5 / task 2.5 move first-item focus to run on `placed`. I confirmed this is necessary, not cosmetic. In `ActionsMenu.tsx`, the focus `useLayoutEffect` on `[isOpen]` runs in the same commit as the hook's placement effect. At that point the `<ul>` was rendered with `placed` false, so it is `visibility: hidden`, and a real browser refuses focus on a hidden element.

- **D2 Select parity: holds.**
  - I re-read `selectPanelFit.ts`. D2's rule with `prefer: "below"` is the same as `fitSelectPanel`: fits below → below; else above if above > below; else below capped. The arithmetic and the 8px margin match.
  - `selectPanelFit.test.ts` has no naturalHeight-0 case.
  - `Select.tsx:148` already returns early on `scrollHeight === 0`, so the no-layout branch never changes Select's live outputs.

- **Round-1 CR2 (phone e2e target): NOT addressed. The new target does not exist either.**
  - D8's phone case and the spec's "Touch-sized menu fits on a phone" scenario both name a dashboard panel card's ⋮ (`PanelCardHeader`) at 390x844.
  - At ≤768px the dashboard renders panels through `MobilePanelStack`, which uses `PanelCardBody` and not `PanelCardHeader`:
    - `grep -c ActionsMenu frontend/src/features/panels/ui/grid/MobilePanelStack.tsx` gives `0`.
    - Its only panel-card render is `<PanelCardBody` at line 94.
  - **Live check** (worktree dev server 7182, 390x844, dashboard `e44e7c57-…`, "Helio Roadmap (copy)", 5 panels): the only `.actions-menu__trigger` on the page is "Dashboard actions" at top 14. No panel card has a ⋮.
  - D8's fallback ("If no panel kind can be created through the API…") applies only when panel *creation* fails. It does not cover the surface being absent. The executor would have to improvise, which is exactly the failure CR2 asked to close.
  - **Live check of a real alternative** (same server, 390x844, pipeline `555f4bae-…`): ActionsMenu triggers render at phone width for "Pipeline actions" (top 68), "Source actions for Profit" (top 263) and "Output actions for …" (tops 787 and 877; the `.bottom-nav` top is 776). The pipeline spine's Output/Step ⋮ (`SpineOutputs` / `SpineStepRow`) is a real phone ActionsMenu that sits near the bottom edge.

- **Other claims re-checked:**
  - The 13 production `<ActionsMenu` call sites match D7's list.
  - `usePortalPopover`: `place` runs in a layout effect, sets `placed`, re-runs on resize, and un-places on close. The horizontal clamp only runs when `right` is defined and the rect is non-zero, so D4's "no-op after place" holds.
  - The `outputSchemaPanelPlacement.ts` precedent anchors "above" with `bottom = innerHeight - trigger.top + gap`. D2a's formula matches it.

### Verdict: REFUTE

### Change Requests

1. **Replace the nonexistent phone e2e surface (design.md D8 phone bullet, spec.md "Touch-sized menu fits on a phone" scenario, tasks.md 3.1).**
   - **Problem:** at ≤768px a dashboard panel card has no ⋮. `MobilePanelStack` renders `PanelCardBody` only, and the live check above confirms it. The planned phone case cannot be built.
   - **Required revision:**
     - Name a phone ActionsMenu that exists at 390x844 and can sit near the bottom edge. The pipeline detail spine's Output ⋮ (`SpineOutputs`, "Output actions for <name>") or Step ⋮ (`SpineStepRow`) both qualify: Output triggers rendered at y=787/877 on a pipeline with two outputs. The pipeline, source and outputs can be created through the API with exact-id teardown.
     - Scroll so the trigger sits above `.bottom-nav` (top 776 at 844 tall) and within the touch menu's height of the bottom.
     - Update the spec scenario title and WHEN clause, D8 and task 3.1 to match.
     - Record next to the dashboard-list note that phone dashboard panel cards carry no ⋮ either, so the final gate can trace it.
     - Remove or reword the fallback clause so it no longer implies that the panel-card surface exists.

### Non-blocking notes

1. **No-layout detection.** Key the no-layout rule on `panel.scrollHeight === 0`, as `Select.tsx:148` does, not on a derived "natural height" that might absorb a NaN or non-zero chrome term. If that guard ever misses in jsdom, `prefer: "above"` flips below and the HEL-719 test goes red. D2a correctly says that means the implementation is wrong, not the test.
2. **Make the two new unit tests falsifiable** (tasks 2.4 and 2.5).
   - **Focus after placement:** jsdom will focus a `visibility: hidden` element, so "focus lands after placement" passes even with the focus effect still on `[isOpen]`. A falsifiable form: spy on `HTMLElement.prototype.focus` and record the menu's `style.visibility` at the moment of the call. Assert it is not `"hidden"`. This fails against today's ordering.
   - **Hidden before placement:** placement completes inside `act`, so asserting after `fireEvent.click` always sees it placed. Use a mechanism that actually observes the pre-placement render, for example `jest.mock` of `usePortalPopover` returning `placed: false`, or recording `style.visibility` from a ref callback on first attach.
3. **`popover-in` animation.** D8 already waits on `getAnimations()`. Keep it: the `translateY(-3px)` shifts rects during the first frames.
4. **Bottom nav.** The phone menu may still overlap `.bottom-nav` when it opens below. It paints above the nav (z 100), so this is cosmetic, but the e2e's `elementFromPoint` will confirm it.
