# Files Modified — HEL-1085

## Backend

- `backend/src/main/scala/com/helio/services/panels/PanelPacker.scala` — added `PanelKind.Form -> ClampBounds(minW = 3, minH = 5, maxH = 24)` to `Bounds` (task 1.1).
- `backend/src/test/scala/com/helio/services/panels/PanelPackerSpec.scala` — new `clamp` case proving the form entry (task 4.1, mutation-tested).

## Frontend — shared primitives

- `frontend/src/shared/ui/TextField.tsx` — extended the `type` union with `"date"` (task 2.1).
- `frontend/src/shared/ui/FormField.tsx` — added `hintId?: string`, applied to the hint `<p>` only (task 2.2).
- `frontend/src/shared/ui/Select.tsx` — added `ariaRequired?: boolean` → `aria-required` on the trigger (task 2.3).
- `frontend/src/shared/ui/Toggle.tsx` — added `ariaInvalid`/`ariaDescribedBy`/`ariaRequired` → the native input (task 2.4).

## Frontend — form rendering

- `frontend/src/features/panels/state/formFieldValidation.ts` (new) — required-empty and numeric-typing validation, message naming the label (task 3.1).
- `frontend/src/features/panels/state/formFieldValidation.test.ts` (new) — task 4.2.
- `frontend/src/features/panels/ui/form/useFormPanelValues.ts` (new) — per-instance draft state: seed from `initialValue`, touched/errors, `setValue`/`touch`/`reset`, re-seed on field-list change (task 3.2).
- `frontend/src/features/panels/ui/form/useFormPanelValues.test.ts` (new) — task 4.3.
- `frontend/src/features/panels/ui/form/FormFieldControl.tsx` (new) — control switch inside `FormField`, id wiring, issue/`file` surfacing (task 3.3).
- `frontend/src/features/panels/ui/form/FormFieldControl.test.tsx` (new) — task 4.4.
- `frontend/src/features/panels/ui/form/FormPanelView.tsx` (new) — schema fetch + skeleton/`InlineError`+Retry, `<form>` with prevented submit (task 3.4).
- `frontend/src/features/panels/ui/form/FormPanelView.test.tsx` (new) — task 4.5.
- `frontend/src/features/panels/ui/form/FormPanel.css` (new) — the form's internal field-stack layout (task 3.4).
- `frontend/src/features/panels/ui/renderers/FormRenderer.tsx` (new) — dispatch point: unconfigured placeholder vs. `FormPanelView` (task 3.5).
- `frontend/src/features/panels/ui/PanelContent.tsx` — `form` branch now dispatches to `FormRenderer` (task 3.5, mutation-tested).
- `frontend/src/features/panels/ui/PanelContent.test.tsx` — new configured-form-panel dispatch case (task 4.6, mutation-tested).
- `frontend/src/features/panels/ui/PanelContent.css` — `.panel-content--form` joins the F-038 scroll recipe, plus its own layout/container-query rules (task 3.6).
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.test.tsx` — new view-mode-renders-fields case (task 4.7).
- `frontend/src/theme/elevationTokenGuard.css.test.ts` / `frontend/src/theme/motionTokenGuard.css.test.ts` — pinned CSS-file-count bumped 114 → 115 for the new `FormPanel.css`.

## E2E

- `e2e/hel1085-form-field-renderers-keyboard.spec.ts` (new) — task 4.8. Seeds a dataset + dashboard + form panel via the real API, drives all six controls by keyboard alone against this run's servers, asserts computed accessible name/description and `aria-invalid`/error association, captures light+dark screenshots to `.concertino/runs/HEL-1085/evidence/`.

## Mutation-test evidence (systematic-debugging.md)

- **PanelPackerSpec (task 4.1)**: removed the `PanelKind.Form` `Bounds` entry → `clamp("form", 1, 2, 12)` returned `(1, 2)` instead of `(3, 5)` — test failed as expected (RED). Restored → GREEN, 13/13 passing.
- **PanelContent.test.tsx (task 4.6)**: removed the `isFormPanel` branch in `PanelContent.tsx` → both the pre-existing "unconfigured placeholder" test and the new "dispatches to FormRenderer" test failed (RED, fell through to `MetricRenderer`). Restored → GREEN, 28/28 passing.

## Verification gates (frontend/**, backend/**)

- `npm run lint` — clean, 0 warnings.
- `npm run typecheck` — clean.
- `npm run format:check` — clean.
- `npm test` — 3564/3564 passing (331 suites).
- `npm --prefix frontend run build` — succeeds.
- `DEV_PORT=6517 npx playwright test e2e/hel1085-form-field-renderers-keyboard.spec.ts` — 1/1 passing against this run's live servers.
- `sbt test` (backend) — in progress at commit time; see commit message / final report for the fresh result.
