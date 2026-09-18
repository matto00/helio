## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/form-panel-rendering/spec.md`,
  `specs/form-panel-builder/spec.md` in full.
- Confirmed the HEL-1089 placeholder cited by the design actually exists as described:
  `frontend/src/features/panels/ui/form/FormFieldControl.tsx:159` `case "counter"` is a plain numeric
  `TextField`, with the HEL-1089 comment (lines 155-158) deferring compact chrome to this ticket — matches.
- Confirmed `FormFieldSpec.step`'s stale comment exists exactly as described:
  `frontend/src/features/panels/types/panel.ts:187-190` ("Valid only alongside `control: "number"`...
  Superseded as the counter discriminator by HEL-1089").
- Read `frontend/src/features/panels/ui/form/FormPanelView.tsx` end-to-end for the actual submit path the
  design says it reuses unmodified: `handleSubmit` (lines 104-155) is a single **whole-form** handler wired
  to the `<form onSubmit>` — it calls `values.markAllTouched()`, then `validateForSubmit(config, schema,
  values.values)` over **every** field's current value (not just one field), then on success conditionally
  calls `values.reset()` when `config.submit.resetOnSuccess !== false` (line 141).
- Read `form-panel-submit`'s existing spec requirement "A successful submit resets the form unless configured
  not to" (`openspec/specs/form-panel-submit/spec.md:235-245`): default (`resetOnSuccess` absent) resets all
  field values to their pre-submit/initial state on every successful submit.

### Verdict: REFUTE

The artifacts have two unresolved internal contradictions that a competent implementer cannot resolve without
guessing, both centered on how the compact counter's live "current value" is supposed to survive the very
submit mechanism the design says it reuses unmodified.

### Change Requests

1. **`design.md` Decision 1 and Decision 3 contradict each other on whether the displayed value resets or
   accumulates, and the ambiguity is load-bearing for the ticket's own AC.**
   Decision 1 says each `+`/`-` activation submits immediately, "then (matching `form-panel-submit`'s existing
   'reset unless configured otherwise' behavior) the display returns to reflect the last accepted state rather
   than accumulating client-side." Decision 3 says the opposite in the very next paragraph: "On a successful
   counter submit, update that local value optimistically **by the submitted delta** (not by re-fetching)" —
   i.e. accumulate, not reset.
   These cannot both be true. Verified against the real reused code
   (`FormPanelView.tsx:141`, `if (config.submit.resetOnSuccess !== false) values.reset();`): the **default**
   behavior for every existing form panel is to reset all field values back to their pre-submit state after
   every successful submit. If that default is genuinely "reused unmodified" for the compact counter layout
   (as the design's own Context section states: "submit path, error handling, live-region announcement, and
   reset-on-success behavior are all reused unmodified"), then every `+`/`-` click resets the counter's
   displayed value to `initialValue` immediately after each submit — the counter would visually never move,
   which directly defeats the ticket's AC ("the control exposes its current value... to assistive technology")
   and the entire premise of a compact "live counter" chrome described in Decision 1's own rationale.
   **Required revision:** state explicitly, as a Decision (not two contradicting sentences), whether:
   (a) the counter control unconditionally ignores the form-level `resetOnSuccess` and always tracks the
   optimistic accumulated value (Decision 3's approach) regardless of panel config, or
   (b) the compact single-counter-field panel config is required/forced to carry `resetOnSuccess: false` so the
   existing reset behavior naturally does not fire.
   Whichever is chosen, add a spec requirement/scenario for it in `specs/form-panel-rendering/spec.md`'s
   "counter"-control requirement — currently neither document states this, so it is untestable as written.

2. **The `+`/`-` "submit immediately" behavior is specified generically, but the standard multi-field layout
   reuses the same whole-form submit handler — activating a counter embedded among other fields would
   prematurely submit those other fields' in-progress, possibly-invalid values.**
   The spec's scenario "Counter increments via its `+` button with Enter or Space" and "submits ... through
   the panel's existing submit path" is written with no qualification to the single-counter-field compact
   layout. The proposal explicitly requires a counter field embedded in a *multi-field* form (e.g. "two
   fields, one counter and one text") to render "via the ordinary `case "counter"` control... inside that
   layout" (proposal.md, "What Changes", last bullet; spec.md "Two fields including a counter keep the
   standard layout" scenario) — i.e. the same `+`/`-` immediate-submit control sits inside the standard
   `FormPanelView` form. Verified `handleSubmit` (`FormPanelView.tsx:104-155`) is the **only** submit path,
   and it is whole-form: `markAllTouched()` + `validateForSubmit` over every field, not just the field that
   triggered it. As designed, clicking `+` on a counter that is one field among several would run
   `markAllTouched()` (painting `aria-invalid` on every other untouched field) and submit the *entire* form's
   current values — including whatever partial/placeholder values sit in sibling fields the user has not
   finished entering — as a real row-appending API call. This is a standing-write-path concern the ticket
   itself calls out ("increments append real rows... verify rows land only on the bound `dataSourceId`") but
   the design never addresses this specific hazard: a counter click inside a multi-field form silently
   submitting unrelated, possibly not-yet-intended field values.
   **Required revision:** either (a) explicitly restrict the "submits immediately on `+`/`-`" behavior to the
   single-counter-field compact layout only, and specify that a counter embedded in a multi-field form renders
   its value/`+`/`-` purely as *local* state that participates in the form's existing single "Submit" button
   like every other field (no per-click submit), or (b) if per-click immediate submission really is intended
   even inside a multi-field form, add an explicit design decision and spec scenario stating that the other
   fields' current values are submitted alongside it every time, and confirm that is an acceptable/intended
   write-path behavior (it currently reads as an unconsidered side effect, not a decision).

### Non-blocking notes

- Proposal/design/tasks/specs are otherwise unusually well cross-referenced and the file-level claims (existing
  placeholder code, `step` comment, clamp bounds) all checked out against the tree as stated — the gap is
  specifically the submit/reset interaction called out above, not a general soundness problem.
- Task 4.6's "PanelPacker clamp — evaluate and state explicitly" framing is fine as written; no revision needed.
