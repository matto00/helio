## Why

When a compact counter's step is rejected by the server, the same message is rendered twice — once as the field's
own error (`FormField`'s `role="alert"` paragraph) and once in the compact layout's always-mounted
`.form-panel-view__alert` region — so sighted users read it twice and screen readers announce it twice (HEL-1818,
a follow-up of HEL-1804).

## What Changes

- For the compact single-counter layout only, a definite rejection's message is carried by the always-mounted
  form-level assertive region (`.form-panel-view__alert`) and nowhere else. Owner ruling (escalation answered
  `form-alert-B`, 2026-11-22): the pre-existing live region carries it, not the field error.
- The counter field renders no error text of its own for that rejection, but its control stays
  `aria-invalid="true"` and its `aria-describedby` resolves to the form alert region, so the control's computed
  accessible description is still the message.
- Live regions stay mounted (HEL-1804's rule — empty regions are `position: absolute`, keep their roles, no
  `display`/`visibility` change). Nothing about the indeterminate "couldn't confirm" path changes.
- The multi-field form is unchanged: it keeps its form-level summary plus per-field errors (the error-summary
  pattern, where the summary names several fields and each control carries its own). HEL-1819 is queued on that path.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `form-panel-submit`: the counter rollback requirement states that a compact counter's rejection message appears in
  exactly one place (the assertive region), with the control described by that region.

## Impact

- Frontend only: `frontend/src/features/panels/ui/form/FormPanelView.tsx`, `FormFieldControl.tsx` (an optional prop
  to point the control's description at an external element instead of rendering its own error text), and their
  jest tests; e2e specs that assert the compact counter's field error text, if any. No backend, schema or
  migration change. `e2e/hel1791-compact-counter-stack-height.spec.ts` is NOT touched (HEL-1826 owns it).
