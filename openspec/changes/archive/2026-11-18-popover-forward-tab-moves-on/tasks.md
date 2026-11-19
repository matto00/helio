## Standing Constraints

## 1. Red first (record every red run in .concertino/scratch/HEL-1776/)

- [x] 1.1 Probe on main, in Playwright against this lane's servers, where a native forward Tab off the dashboard-list actions menu's item lands (focused element, menu open/closed); record it. Verify by the recorded probe output.
- [x] 1.2 Grep `e2e/` and `frontend/src` for forward `Tab` presses/assertions on ActionsMenu, the appearance editor, Select and ProvenancePopover (incl. hel1003, hel1756, ActionsMenu.test.tsx "Tab away closes"); list any that encode forward-Tab-to-trigger. Verify by the recorded grep list.
- [x] 1.3 Add to `e2e/hel1759-popover-keyboard-focus.spec.ts`, each case pressing `End` (menus) to reach the LAST enabled item, asserting it is focused, then pressing Tab: (a) desktop dashboard-list row actions menu - menu closes, focus on the concrete next control after that row's trigger (name it from the live DOM in the red evidence, e.g. by role/name, and locate it independently of the D3 algorithm); (b) phone step sheet `dialog[open]` "Step actions for ..." menu - menu closes, focus on the sheet header's "Close" button (the control after `headerActions` in `Modal.tsx`); (c) desktop appearance editor, Tab forward off "Save dashboard style" - editor closes, focus on the concrete next control after the "Customize dashboard appearance" trigger (name it from the live DOM). Every case also asserts the trigger is NOT focused and `document.activeElement !== document.body`. Update the file header comment. Run the FULL spec on unchanged code and record that the new cases fail for the right reason (case (b) must fail by landing on the trigger / dialog first focusable, the "Modal wins" outcome) and the existing cases pass.
- [x] 1.4 Add unit tests: `usePortalPopover.test.tsx` forward-Tab-out case (target is next after trigger, not trigger), the same with the panel inside a dialog that has a Modal-style dialog-level wrap listener (hook wins, no double move), Shift+Tab unchanged, a Tab already `defaultPrevented` by a same-panel listener ignored, real ProvenancePopover host: loading-state Tab off "Close provenance" keeps it open with focus there, and ready-state Tab off its last focusable wraps to its first (design D2); helper tests for next-tabbable (skips panel contents, disabled, tabIndex -1, hidden; dialog scope wrap; fallback to trigger). Record the red run.

## 2. Implementation

- [x] 2.1 Direction-aware Tab tracking in `usePortalPopover` (design D1). Verify by unit tests.
- [x] 2.2 Next-tabbable helper module (D3). Verify by its unit tests.
- [x] 2.3 Forward-Tab keydown interception and focusout direction split (D2); update the hook's doc comment. Verify by unit tests and the full hel1759 spec.
- [x] 2.4 Mutation checks, each recorded red: (i) restore forward-Tab refocus of the trigger -> new forward cases go red; (ii) target the trigger's previous tabbable -> red; (iii) remove the `defaultPrevented` guard -> the real-ProvenancePopover Tab-wrap test goes red (D2); (iv) move the hook's Tab listener from the panel to `document` bubble with a "skip when defaultPrevented" rule (the round-1 design, i.e. "Modal trap wins") -> e2e case (b) goes red; (v) defer the target focus to `setTimeout(..., 0)` -> case (b) is expected red (the Modal trap wraps to the trigger first); record the result whichever way it lands.

## 3. Verification

- [x] 3.1 Full `e2e/hel1759-popover-keyboard-focus.spec.ts`, `hel1003-actions-menu-keyboard-reach.spec.ts`, `hel1756-popover-viewport-fit.spec.ts` and any spec found in 1.2, on a lane-private DB (`helio_hel1776`), Playwright 2 workers. Verify all pass.
- [x] 3.2 `npm run lint`, `npm run typecheck`, `npm run format:check`, frontend jest (3 workers) green; files-modified.md lists only the hook, the helper, their tests, the hel1759 spec (and any test from 1.2 that encoded the overruled behaviour).
