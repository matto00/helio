## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/form-panel-rendering/spec.md`,
  `specs/form-panel-builder/spec.md` in full (current state, post-revision).
- Read `skeptic-design-1.md` (round 1) as a claim, not fact, and independently re-checked both of its CRs
  against the revised artifacts.
- Re-read `frontend/src/features/panels/ui/form/FormPanelView.tsx:104-155` (the real `handleSubmit`) to confirm
  the revised Decision 3 mechanism is actually compatible with the reused code, not just asserted to be:
  confirmed line 141 is still `if (config.submit.resetOnSuccess !== false) values.reset();` — matches the
  design's premise that forcing `resetOnSuccess: false` on the compact-layout config suppresses this reset,
  letting Decision 3's optimistic accumulation survive.

### CR1 (round 1) — reset-vs-accumulate contradiction

Resolved. Decision 3 now states both halves together explicitly: accumulate the local tally by `±step` on
each successful compact-layout submit, AND force `submit.resetOnSuccess: false` on the compact layout's
persisted config so the reused `handleSubmit` reset path never fires for it. This is internally consistent,
verified compatible with the real `handleSubmit` code, and is backed by spec scenarios ("Compact layout —
incrementing submits the configured step as a delta immediately", "...decrementing...", "...a rejected submit
reverts the optimistic value change") in `specs/form-panel-rendering/spec.md`.

One residual (non-blocking) gap: `design.md` Decision 3 and `tasks.md` task 2.2 both state the *builder* is
responsible for force-persisting `resetOnSuccess: false` for single-counter-field configs, but neither
`specs/form-panel-builder/spec.md` nor `specs/form-panel-rendering/spec.md` contains a requirement/scenario
capturing this specific persistence behavior — the only place it's testable-on-paper is a tasks.md checkbox,
not a spec scenario. Since the mechanism is otherwise unambiguous and directly executable from design.md +
tasks.md, I'm treating this as a documentation-completeness gap rather than a blocking ambiguity — flagged
below as a non-blocking note, not a Change Request, because it doesn't leave any implementer decision
underspecified.

### CR2 (round 1) — premature whole-form submit from an embedded counter

Resolved. Decision 1 now explicitly splits behavior by which layout renders the counter: the compact
single-field layout submits immediately (there is nothing else in the form to prematurely submit — verified
this is true, since the compact layout by definition has `fields.length === 1`), and a counter embedded in a
2+-field form is local-state-only on `+`/`-`, submitting only via the form's existing single Submit control
exactly like every other field. This is now backed by explicit spec scenarios ("Embedded in a multi-field
form — activation updates local value only, nothing is submitted" and "Embedded field's local value is sent
on the form's own submit, like any other field") and by task 2.4, which requires an explicit test that
clicking a counter embedded in a multi-field form does not touch/submit sibling fields — directly targeting
the hazard I raised in round 1.

### Additional adversarial pass (round 2)

- Checked all five design.md Decisions against each other and against the spec deltas for new internal
  contradictions introduced by the rewrite — none found. Decision 2 (render-branch keyed on
  `fields.length === 1 && control === "counter"`, `immediate` prop threaded into the shared `FormFieldControl`
  counter case) is consistent with Decision 1's two behaviors and with tasks 1.2/2.1.
  Decision 4 (ARIA) and Decision 5 (`step` sharing) are unchanged from round 1 and were not implicated by
  either CR; re-checked them against the current spec text and they still match.
- Checked scope/boundary coverage: zero fields, one non-counter field, one counter field (compact), 2+ fields
  including a counter, all have explicit spec scenarios and explicit tasks (2.3, 2.4) — matches the ticket's
  own call-out that a silent fallthrough is a known prior defect shape.
- Checked the proposal's Non-Goals / Impact sections still agree with the revised design (no new PanelKind, no
  new route, no backend change) — consistent throughout.
- No contract/schema delta is required by this change (presentation-layer only, confirmed by the proposal's
  Impact section and by the fact the wire shape submitted is unchanged `{delta: ±step}`, identical to
  HEL-1089's existing contract) — nothing missing there.

### Verdict: CONFIRM

Both round-1 contradictions are genuinely resolved, not reworded around — the resolution required stating a
mechanism whose compatibility with the real reused code I independently re-verified (`handleSubmit`'s reset
gate). No new internal contradiction, ambiguity, or scope gap found in this pass.

### Non-blocking notes

- Add a `specs/form-panel-builder/spec.md` requirement/scenario for "saving a single-counter-field form config
  always persists `submit.resetOnSuccess: false`" so this behavior has spec coverage instead of only a tasks.md
  checkbox (design.md Decision 3, tasks.md 2.2). Not blocking — the behavior is unambiguous as written, but
  spec coverage would make it independently testable against the capability's contract rather than only
  against a task list.
- Round 1's non-blocking notes (well-cross-referenced artifacts; task 4.6's clamp framing) still hold.
