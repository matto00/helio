## Why

A multi-field form card is 24 px taller than its content: the always-mounted, empty `role="alert"` and `role="status"`
paragraphs inside `.form-panel-view__fields` (a flex column with a 12 px gap) each claim a gap slot between the last
field and Submit. HEL-1804 fixed the same defect for the compact counter. Separately (owner scope addition), after a
rejected compact counter step, a later no-response click whose reconciliation succeeds leaves the control
`aria-invalid` and red with no visible message, because nothing on that path clears the stale field error.

## What Changes

- `FormPanel.css`: `.form-panel-view__fields` becomes the containing block (`position: relative`) and an EMPTY
  alert/status region that is a direct child of it is `position: absolute` (out of flex flow). The regions stay
  mounted, keep their roles, and return to flow as soon as they hold text. No `display`/`visibility` change.
- `FormPanelView.tsx` (compact counter immediate step): when an indeterminate (no-response) settle's reconciliation
  fetch succeeds and is applied, clear the field's external error, unless a definite rejection settled in the same
  burst (that rejection's error and its alert text must survive, per the existing reconciliation requirement).
- Tests: a jest CSS guard, jest behaviour tests for the error clear, and an e2e geometry check at 390/768/1100 px,
  light and dark.

## Capabilities

### New Capabilities

### Modified Capabilities
- `form-panel-rendering`: adds a requirement that the multi-field form reserves no space for its empty live regions.
- `form-panel-submit`: adds a requirement that a stale counter rejection error is cleared once a later burst's
  reconciliation succeeds, and modifies the rollback requirement's "only a later request's own success clears it"
  sentence to name that second clearing path (owner ruling).

## Non-goals

- HEL-1618 (minimum-height form panel clips fields and Submit) — queued separately on the same files.
- Any change to the compact counter's layout (HEL-1804) or to which region carries a rejection message (HEL-1818).
- Backend, schema or migration changes.

## Impact

Frontend only: `frontend/src/features/panels/ui/form/FormPanel.css`, `FormPanelView.tsx`, their tests, and one e2e
spec. No API change.
