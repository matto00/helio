## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 108c04b7f71c110ba6a7f82d89f93c0c28de383c. The change dir is untracked planning output.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/actions-menu-forward-tab/HEL-1776`.
- **Artifacts read:** ticket.md, proposal.md, design.md, tasks.md, specs/portal-popover-hook/spec.md, skeptic-design-1.md.
- **Live code read:**
  - `hooks/usePortalPopover.ts` (all of it)
  - `shared/ui/Modal.tsx:50-55, 205-282`
  - `shared/motion/BottomSheet.tsx:80-106`
  - `features/pipelines/ui/mobile/MobileStepSheet.tsx:30-110`
  - `shared/chrome/ActionsMenu.tsx:55-210`
  - `features/panels/provenance/ProvenancePopover.tsx` (all of it)
  - `features/panels/provenance/useProvenancePopoverHost.tsx` (all of it)
  - `features/dashboards/ui/DashboardAppearanceEditor.tsx:140-365`
  - the test names and Tab presses in `e2e/hel1759-popover-keyboard-focus.spec.ts`
  - a grep for `"Tab"` across `frontend/src` (non-test): Modal, MobileNavSheet, ProvenancePopover, DatasetRowGrid (an editor `<input>` handler, not an ancestor of any popover), and the hook's tracker.

#### Round-1 CR1 (Modal trap pre-empts a document listener): RESOLVED
D2 now attaches a native keydown listener to the panel itself. The ActionsMenu panel is a descendant of the dialog when
it is portalled into `dialog[open]` (`ActionsMenu.tsx:103,185`), so its listener fires before Modal's trap on the
`<dialog>` (`Modal.tsx:240`). The hook calls `preventDefault()` and moves focus to the target, so the browser's own move
never happens. The false "Modal wins" sentence is gone.

#### Round-1 CR2 and CR3 (last item, named targets): RESOLVED
- Task 1.3 now presses `End` on every menu. `End` is handled at `ActionsMenu.tsx:134-137`.
- Case (b) names "Close" as the target. That is correct: the sheet header is h2 (`tabIndex=-1`, excluded), then
  `headerActions` (only the ActionsMenu, `MobileStepSheet.tsx:66-71`), then the Close IconButton (`Modal.tsx:263-271`).
- The dialog's first `FOCUSABLE_SELECTORS` match is therefore the ActionsMenu trigger. On main, and under mutation
  (iv), case (b) lands on the trigger, so it is a genuine red that a "Modal wins" implementation fails.
- Cases (a) and (c) name their target from the live DOM.
- Every case asserts that the trigger is not focused and that focus is not on `<body>`.
- Save in the appearance editor is `aria-disabled`, not `disabled` (`DashboardAppearanceEditor.tsx:333-339`), so it
  stays tabbable and is the last control. The exception is when `InlineError` renders a control, which is not the
  failed-save path's concern.

#### Listener order, ProvenancePopover before the hook: CORRECT as stated, conditionally
- ProvenancePopover registers its native panel keydown listener in a passive `useEffect([])`
  (`ProvenancePopover.tsx:107-129`).
- It is rendered as a child of the component that calls `usePortalPopover` (`useProvenancePopoverHost.tsx:146-162`).
- It mounts in the same commit that sets `isOpen`, because `handleOpen` sets `panelPos` and `isOpen` together.
- Child passive effects run before the parent's, so its listener is registered first, provided the hook attaches in a
  **passive** effect. A `useLayoutEffect` or callback-ref attachment would invert the order.
- Its `stopPropagation()` does not stop same-element listeners, as D2 says.
- D2 makes the executor prove this order with a real-host test. Acceptable.

#### NEW defect A: mutation 2.4(v) cannot go red, and D2's rationale for `stopPropagation` is wrong
- D2 says the Modal trap "ignores `defaultPrevented`, so propagation must stop or it would move focus a second time".
- The trap does ignore `defaultPrevented`. But it acts only when `document.activeElement === last`
  (`Modal.tsx:225-236`), and `last` is the dialog's last match: the last menu item, because the portalled `ul` is
  appended at the end of the dialog.
- When the event reaches the dialog, the hook's panel listener has already focused "Close". A synchronous `focus()`
  does this directly. A `queueMicrotask` also does it first, because microtasks are checkpointed after each listener
  callback of a trusted event.
- So `activeElement` is "Close", not `last`, and the trap does nothing whether or not propagation was stopped.
- Mutation (v), "drop stopPropagation, case (b) goes red", therefore stays green under any implementation that moves
  focus inside the listener.
- Worse, the mandated red pushes the executor toward a worse implementation, such as deferring focus with
  `setTimeout`, to manufacture it. The listener cannot defer focus with `setTimeout`: if it did, the trap would see
  `activeElement === last`, would wrap to the trigger, and the deferred focus would then fight it. That is exactly the
  kind of shaping a gate must not invite.

#### NEW defect B: mutation 2.4(iii) only goes red for one specific test shape
- D2 keys the hook on "`activeElement` inside the panel with no tabbable after it". ProvenancePopover's listener runs
  first, and at its last element it calls `first.focus()`.
- With the `defaultPrevented` guard removed, the hook then sees `activeElement === first`. If the panel has two or
  more focusables (ready or error state), `first` has tabbables after it, so the hook still does nothing. The guard
  removal stays green.
- It turns red only when, after the wrap, `activeElement` has no tabbable after it in the hook's own definition. That
  happens in the loading state, where "Close provenance" is the only focusable, or if the hook keyed on `event.target`
  instead of `activeElement`.
- Task 2.4(iii) and D2 ("mutate the guard to prove the test catches it") do not pin this. An executor writing the
  natural ready-state test will see a green mutation and have no specified path.

#### Other checks
- **No new Tab consumer starved by the panel's `stopPropagation`.** The React ancestors of the ActionsMenu hosts
  (DashboardList, DashboardFolderGroup, SidebarItemList, PanelCardHeader) have only rename-input `onKeyDown`
  handlers, not on an ancestor of the trigger's portal path for Tab. The ul's own `handleMenuKeyDown` ignores Tab.
- **The focusout split is consistent with the spec.** A forward Tab intercepted at keydown never reaches the
  `relatedTarget === null` branch. The panel-is-last-in-document case is therefore covered, and the spec's "focus
  leaving the document" clause stays true.
- **AC 3 consumer split unchanged from round 1, still correct.** No escalation is needed.

### Verdict: REFUTE

### Change Requests

1. **design.md D2, the `stopPropagation()` sentence:** replace the rationale "the Modal trap ignores
   `defaultPrevented`, so propagation must stop or it would move focus a second time". The trap is gated on
   `document.activeElement === last` (`Modal.tsx:225-236`). Once the hook has moved focus to its target, that gate is
   false, so the trap is inert either way. Either:
   - keep `stopPropagation()` and label it defensive, hiding an already-handled Tab from bubble-phase ancestors, with
     no live consumer that observes it; or
   - drop it.

   Also state explicitly that the hook must move focus **inside the panel listener**, synchronously or by microtask,
   and never by `setTimeout`. A deferred move would let the trap see `activeElement === last` and wrap to the trigger.
2. **tasks.md 2.4(v):** delete it, or replace it with a mutation that can actually go red. The natural candidate is
   "defer the target focus to `setTimeout(…, 0)`", which makes the Modal trap wrap to the trigger before the deferred
   focus runs and should turn case (b) red. Record its result whichever way it lands. Do not keep a mandated red that
   no correct implementation can produce.
3. **tasks.md 1.4 / 2.4(iii) and D2's ProvenancePopover bullet:** pin the shape of the real-ProvenancePopover test so
   that removing the `defaultPrevented` guard is observable. For example, Tab off the only focusable in the loading
   state ("Close provenance"), where the wrap leaves focus on an element with nothing after it, and assert that the
   popover stays open and focus stays on it. Also keep a ready-state wrap test for behaviour. Alternatively, state
   whether the hook's "last" check reads `event.target` or `activeElement`. That choice decides which test shape the
   mutation needs, and the executor must not discover it by trial.

### Non-blocking notes
- The hook's "tabbable after it inside the panel" definition (D3 rules, with a visibility check) differs from
  ProvenancePopover's own `FOCUSABLE` (`ProvenancePopover.tsx:12-13`, no visibility check, `a[href]` regardless of
  `tabIndex`). If ProvenancePopover ever holds a control it counts but the hook does not, the hook could treat a
  non-last element as last and close the popover. This is unreachable with today's content. Consider having the hook
  skip panels whose own listener already handles Tab, or note the coupling in the hook's doc comment.
- D2 requires the listener to follow the panel node's identity. ActionsMenu uses an inline callback ref
  (`ActionsMenu.tsx:147-149`) that re-runs every render but keeps the same `ul` node. A passive effect keyed on
  `isOpen` is enough for every current consumer, and it is also what preserves the ProvenancePopover order above. Say
  so rather than adding a node-identity mechanism that might move registration earlier.
