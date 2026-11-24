# HEL-1828: Panel detail modal: a typed subtype save's fulfilled response briefly reverts staged title/appearance until the batch flush

## Description

Follow-up to HEL-1615 (PR #1236, merged as d350dd7ae); the owner chose a standalone ticket.

When one panel detail modal save also includes a typed subtype save, for example output controls, that save's
`*.fulfilled` reducer replaces the local panel with the server copy. Any title or appearance edit staged in the same
save, still waiting for the 30 s batch flush, then shows reverted on screen until the flush lands. The data is not
lost, but the UI shows the old value in the meantime. Both of HEL-1615's reviewers found this; it predates HEL-1615.

## Do

- Find every subtype `*.fulfilled` reducer that replaces the whole panel. Make each apply the server copy and then
  re-apply that panel's pending staged update, using the same merge HEL-1615 added to
  `panelsSlice.accumulatePanelUpdate`.
- Check that the batch flush still sends the staged fields exactly once.

## Acceptance criteria

- [ ] A test that fails first: a modal save with a staged title plus an output-controls change shows the new title
      throughout, before and after the flush.
- [ ] No staged field is lost or double-sent.

## Driver notes (claims verified in premise-validation.md)

- HEL-1657 added a `lastSavedAt` case to panelsSlice for layout saves; HEL-1634 resets the panels slice on sign-out.
  Neither may regress.
- Frontend only; no migration.
