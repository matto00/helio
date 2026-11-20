## Why

Since HEL-1784, a dashboard editor (anyone who is not the form's owner) can use a compact counter form panel. Their
counter shows the net of their own `+`/`-` steps only, because they may not read the dataset's aggregate, and that
number resets on reload. Nothing on screen says so, so the number reads like the dataset total. The owner ruled
(HEL-1788): keep the local tally, but label it so it is clear it counts only this person's clicks in this session.

## What Changes

- A non-owner's compact counter shows a short caption under the tally: "Your net change this session".
- The caption is part of the counter value's accessible description, so a screen reader announces it with the tally.
- A non-owner's compact counter tally starts at 0, ignoring the field's `initialValue` (today it starts at
  `initialValue`, which would show a number the user never clicked). Owner behaviour is unchanged.
- The owner's compact counter is unchanged: no caption, same `initialValue` seed, same reconciliation.
- Still no `/api/data-sources/*` request from a non-owner's page (unchanged HEL-1784 behaviour, re-asserted by test).

## Capabilities

### New Capabilities

### Modified Capabilities
- `form-panel-rendering`: a non-owner's compact counter tally starts at 0 and carries a visible, accessibly-associated
  caption.

## Impact

- Frontend only: `frontend/src/features/panels/ui/form/FormPanelView.tsx`, `FormFieldControl.tsx`,
  `useFormPanelValues.ts` (seed option), `CounterControl.css`, their jest tests, and
  `e2e/hel1784-editor-form-submit.spec.ts`.
- No backend, schema, migration or API change. Submitted rows are unchanged (a compact submit sends only the delta).

## Non-goals

- Reading or showing the real dataset total to a non-owner (HEL-1784 ruling stands).
- Persisting the tally across reloads.
- Changing the owner's counter, including its load-time value (it is seeded, not fetched; see design.md Planner Notes).
- Captioning a counter inside a multi-field (stacked) form: there the value is a draft delta that resets on submit for
  every user, owner included, so it is not a tally (see design.md D1).
