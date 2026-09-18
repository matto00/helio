## Why

HEL-1089 shipped the counter field's server-side event-row model but deliberately left its rendering as a plain
numeric `TextField` (`FormFieldControl.tsx` `case "counter"`), because a counter is meant to live in a small panel
and a full-width text input doesn't suit that. HEL-1088 replaces that placeholder with compact `+`/`-`/step chrome,
still writing through the existing `POST /api/panels/:id/submit` delta contract.

## What Changes

- `FormFieldControl.tsx`'s `case "counter"` renders a compact counter control (current value display, `+`/`-`
  buttons, keyboard-operable) instead of the HEL-1089 placeholder `TextField`.
- The counter's step size is authored via the existing `FormFieldSpec.step` (currently commented as
  number-only/superseded — this repurposes it as the counter's step, replacing that stale comment).
- The control exposes its current value and configured step to assistive technology via computed ARIA state
  (`aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-valuetext` or full spinbutton semantics).
- `+`/`-` activation appends a delta submission through the panel's existing submit path — no new endpoint, no new
  `PanelKind`.
- `form-panel-builder` gains an author-time step-size input for a `counter` field (mirroring how `number` already
  exposes `step`).
- Single-counter-field compact layout: when a form panel's config has exactly one field and it is `control:
  "counter"`, the panel renders the compact value/+/-/step chrome layout instead of the standard stacked-field form
  layout with a separate submit button. Any other field count/shape (zero fields, one non-counter field, 2+ fields
  including one counter) keeps rendering the existing standard form layout — the counter field renders via the
  ordinary `case "counter"` control (still improved per above) inside that layout, not as a special compact case.

## Capabilities

### New Capabilities
(none — this modifies existing capabilities)

### Modified Capabilities
- `form-panel-rendering`: adds requirements for the compact single-counter-field panel layout, and updates the
  counter control's rendering (value/+/-/step, computed ARIA state) in place of the current plain-numeric-input
  behavior.
- `form-panel-builder`: adds an author-time step-size input for `counter` fields.

## Impact

- `frontend/src/features/panels/ui/form/FormFieldControl.tsx` — counter control rendering.
- `frontend/src/features/panels/ui/form/` or a new compact-layout component — single-field compact panel body.
- `frontend/src/features/panels/types/panel.ts` — `FormFieldSpec.step` comment/usage.
- `frontend/src/features/panels/ui/editors/` (form-panel-builder) — step-size authoring for `counter`.
- No backend changes: `POST /api/panels/:id/submit` and the `counter` delta contract (HEL-1087/1089) are reused
  unmodified.

## Non-goals

- No new `PanelKind`, no new API route — explicitly ruled out by the ticket ("same panel kind, same submit path").
- No change to the server-side counter delta/aggregate semantics (HEL-1089's contract stands as-is).
- No change to `PanelPacker` clamp bounds unless the compact layout's own spec/test proves a different bound is
  needed (default: keep `minW=3,minH=5,maxH=24` unless proven otherwise).
