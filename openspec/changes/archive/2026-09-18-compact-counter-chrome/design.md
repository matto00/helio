## Context

`FormFieldControl.tsx`'s `case "counter"` (HEL-1089) is a plain numeric `TextField` deliberately left as a
placeholder; the comment names this ticket as the follow-up. The server-side delta contract
(`FormSubmission.buildRow`, `counter-event-row-model` spec) already accepts `{"delta": <number>}` and ignores
client `occurred_at`/`value`. `FormFieldSpec.step` already exists on the type but is annotated as
number-only/superseded — this change repurposes it as the counter's step size. `form-panel-submit`'s existing
submit path, error handling, live-region announcement, and reset-on-success behavior are all reused unmodified;
this change is presentation-layer only.

## Goals / Non-Goals

**Goals:**
- Replace the HEL-1089 placeholder with compact `+`/`-`/value chrome for a `counter` field, keyboard-operable,
  computed-ARIA-exposed value and step.
- Add a compact single-field panel layout specifically for the one-field-and-it's-a-counter case.
- Author-time step configuration for `counter` fields in the form builder.

**Non-Goals:**
- No new `PanelKind`, no new API route (ticket AC: "same panel kind, same submit path").
- No change to server-side counter validation/aggregation (HEL-1089's contract).
- No re-derivation of the true running total client-side — the compact chrome's displayed value (Decision 3) is
  an explicitly cosmetic, session-local optimistic tally, never treated as or presented as the authoritative
  total; the authoritative total remains solely server/pipeline-derived, unchanged from `counter-event-row-model`.
- No PanelPacker clamp change unless proven necessary by a failing layout test.

## Decisions

### Decision 1: Immediate per-click submit applies ONLY to the single-counter-field compact layout; a counter embedded in a multi-field form is local-state-only until the form's own Submit is pressed

(Revised per skeptic-design-1.md CR2 — the generic "counter submits on every `+`/`-`" framing silently
prematurely submitted sibling fields' in-progress values, because `FormPanelView.handleSubmit` is a single
whole-form handler with no per-field submit path.)

Two distinct behaviors, selected by which layout renders the counter:

- **Compact single-counter-field layout** (`fields.length === 1 && fields[0].control === "counter"`): every
  `+`/`-` activation calls the *existing* `handleSubmit` path immediately (there is nothing else in the form
  to prematurely submit — the counter is the only field), submitting `{delta: ±step}`.
- **Counter embedded in a multi-field form** (2+ fields, one of which is `control: "counter"`): `+`/`-`
  activation updates only that field's local value (exactly like typing into a `number` field does) and does
  **not** submit anything. The user still submits via the form's single, existing Submit button, at which
  point the counter's current local value is sent as `delta` alongside every other field, unmodified from how
  `handleSubmit`/`buildSubmitValues` already work for any field.

This removes the unconsidered side effect the skeptic flagged: no click on a counter that shares a form with
other fields can ever submit those other fields' unfinished values.

### Decision 2: The compact layout is a separate render branch keyed on `fields.length === 1 && fields[0].control === "counter"`, not a new component genuinely independent of `FormFieldControl`

The compact chrome reuses the same `+`/`-`/value control `FormFieldControl`'s `counter` case renders (Decision 4
below) — the *layout* wrapping it is what differs (no separate stacked-field container, no separate submit
button in the compact case), not the control itself. `FormFieldControl`'s `counter` case takes a new prop (e.g.
`immediate: boolean`) so the same control implementation serves both Decision 1 behaviors without duplicating the
increment/decrement/ARIA logic. This keeps `form-panel-rendering`'s existing per-control dispatch as the single
source of truth for what a counter control looks like.

### Decision 3: The counter's local value IS a client-side-only optimistic running tally, incremented/decremented by `step` on each successful compact-layout submit; the compact layout's persisted config always forces `submit.resetOnSuccess: false` so that tally survives the existing reset call

(Revised per skeptic-design-1.md CR1 — the original write contradicted itself on reset-vs-accumulate. Resolving
it requires BOTH halves together, not either alone: accumulation is what makes the display move at all;
`resetOnSuccess: false` is what stops the reused `handleSubmit` reset from wiping that accumulation back to
`initialValue` after every single click.)

Mechanism, compact single-counter-field layout only:
1. On `+`/`-` activation, update the field's local value (`useFormPanelValues`'s existing per-field state)
   optimistically by `+step`/`-step` *before* the submit call resolves, then call the existing `handleSubmit`
   path with that value as `delta`.
2. The form builder (task 3.x) SHALL persist `submit.resetOnSuccess: false` whenever it saves a
   single-counter-field form config — not user-configurable for that shape, a direct consequence of choosing
   the compact layout. With it set, `handleSubmit`'s existing `if (config.submit.resetOnSuccess !== false)
   values.reset();` line never fires for this layout, unmodified, so step 1's optimistic value is never wiped.
3. On a rejected/failed submit, revert the optimistic update (subtract the same `±step` back out), consistent
   with `form-panel-submit`'s "rejected submit preserves input" intent — extended here to "preserves the
   pre-click tally," since a rejected click must not silently advance the displayed count.

This client-side tally is explicitly **cosmetic/session-local only** — it is never sent to the server as a
value, never read back from a response, and never claims to be the authoritative running total (which remains
solely server/pipeline-derived per `counter-event-row-model`, unchanged — see that capability's "running total
... never stored" requirement). It resets to `initialValue` (or `0` if unset) on every fresh mount, e.g. a page
reload, exactly like any other field's `initialValue` behavior already does.

For a counter embedded in a multi-field form, none of this applies: no accumulation, no forced
`resetOnSuccess`, no optimistic-tally revert. That form's `resetOnSuccess` behaves exactly as configured for
every other field, and the counter's local value is ordinary field state like `number` already has (Decision
1).

### Decision 4: ARIA exposure uses a `role="spinbutton"` container with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`(when configured)/`aria-valuetext`

`aria-valuenow` communicates the current numeric value directly. `aria-valuetext` is set to a human-readable
string naming both the value and the step (for example `"12, step 5"`) so a screen reader announces both without
requiring the user to separately inspect a step control — this satisfies the AC's "exposes its current value and
step" with a single computed property, verifiable in the evaluator/skeptic browser pass by reading the live
accessibility tree, not by grepping for the attribute's presence in source (MISTAKES.md C8).

### Decision 5: `step` on `FormFieldSpec` is shared by `number` and `counter`; the stale HEL-1089 comment is corrected in place

No new field is added to the type. The existing comment ("Valid only alongside control: number... superseded as
the counter discriminator") is factually wrong once this ships and must be corrected to state `step` is valid for
both `number` and `counter`, with `counter` defaulting to `1` when absent (mirrors `number`'s own default-step
handling already in `renderControl`).

## Risks / Trade-offs

- Optimistic local-tally tracking (Decision 3) can drift from the true server state if a submit both fails
  *after* the request left (network error, response lost) and the user assumes it applied — mitigated by
  reverting the optimistic update on any rejection and by the existing assertive-region announcement on failure
  (`form-panel-submit`), reused unmodified. A page reload always re-derives from `initialValue`, bounding any
  drift to the current session.
- Forcing `resetOnSuccess: false` for single-counter-field configs (Decision 3) is a builder-side normalization,
  not a user-visible toggle — if a future author-time change lets a user hand-edit raw config JSON bypassing the
  builder, that path must also enforce this, or the reset contradiction reappears. Flagged as an explicit
  follow-up-triage candidate at Delivery if the builder is found to have such a bypass.
- Compact layout only triggers on an exact `fields.length === 1` match; a config with a counter plus one other
  field intentionally falls back to the standard layout rather than guessing intent — this is the explicit
  boundary decision from the proposal, not an oversight.
