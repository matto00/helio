## Standing Constraints

- [C1] Owner ruling form-alert-B: for the compact counter, the always-mounted `.form-panel-view__alert` carries a definite rejection's message; the field renders no error text; the control stays `aria-invalid="true"` with `aria-describedby` referencing the alert region. Multi-field form unchanged.
- [C2] Never edit `e2e/hel1791-compact-counter-stack-height.spec.ts` (HEL-1826 owns it).

## 1. Red first

- [x] 1.1 In `frontend/src/features/panels/ui/form/FormPanelView.test.tsx`, add a test: a compact counter whose step is rejected (400 with a message) shows the message exactly once in the panel (text-count assertion over the panel's text), exactly one `role="alert"` element in the panel contains it (it is `.form-panel-view__alert`), no `.ui-form-field__error` is rendered, the spinbutton is `aria-invalid="true"` and its `aria-describedby` references the alert's id with computed accessible description equal to the message; and the empty `role="status"` region is still mounted. Add a second test: two identical rejections in a row — the alert is emptied at the second step's start and holds the message again, still once. Run the full spec file, confirm the new tests FAIL on current code, save the run to the main checkout's `.concertino/scratch/HEL-1818/red-run.txt`, and commit the red tests (or record the .txt if the hook refuses).
- [x] 1.2 Add a multi-field regression test (or confirm an existing one covers it and cite it): a rejected multi-field submit still shows the alert summary AND the control's own field error. It must pass before and after.

## 2. Implementation

- [x] 2.1 `FormFieldControl.tsx`: add the optional external-description id prop per design.md D2; verify with `FormFieldControl.test.tsx` cases (error + prop → no error paragraph, `aria-invalid="true"`, describedby = external id [+ caption id]; error null → unchanged).
- [x] 2.2 `FormPanelView.tsx` compact branch: give the alert `<p>` a `useId()` id and pass it to `FormFieldControl`. No change to `handleImmediateStep`'s state logic or to the multi-field branch. Verify 1.1 goes green and 1.2 stays green.
- [x] 2.3 Mutation checks: (a) revert 2.2's prop pass → 1.1 fails; (b) make the alert not receive text (drop `setAlertText(message)`) → 1.1 fails; record both in scratch.

## 3. Adjacent tests and e2e

- [x] 3.1 Update any existing jest tests (`FormPanelView.test.tsx`, `FormPanelView.nonOwner.test.tsx`, `FormFieldControl.test.tsx`) that asserted the compact counter's own field error text, stating why in the diff. Run full files.
- [x] 3.2 Check e2e specs exercising compact counter rejection (hel1088, hel1095, hel1169; NOT hel1791) for assertions on the field error paragraph; update only if needed. Add `e2e/hel1818-compact-counter-single-error.spec.ts`: a rejected step (route-fulfilled 400) renders the message once and announces once (one `role=alert` in the panel holding it, control described by it), in light and dark, at 390 and 1440 px. Run it with 2 workers max against the lane DB.

## 4. Gates

- [x] 4.1 `npm run lint`, `npm run typecheck`, `npm run format:check`, and the full form-panel jest directory pass.
