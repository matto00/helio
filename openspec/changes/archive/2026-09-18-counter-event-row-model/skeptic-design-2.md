## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/counter-event-row-model/spec.md`, `specs/form-panel-submit/spec.md`) in full, fresh (not
  from round 1's narrative).
- **Round-1 fix 1 (time-series Output scenario untested):** confirmed `tasks.md` §2.7 now exists and
  builds a pipeline Output over a counter dataset ordered by `(occurred_at, seq)`, asserting one
  point per event via the real pipeline engine — traces directly to the spec's "A time-series Output
  renders the append sequence" scenario. Fixed.
- **Round-1 fix 2 (Decision 3a failure mode):** confirmed `design.md`'s new "Failure mode" paragraph
  under Decision 3a extends `FormSchemaConsistency.check` with a counter-specific structural rule,
  and `specs/counter-event-row-model/spec.md` gained a matching new requirement ("A counter field can
  only be bound to a dataset that structurally supports the row shape") with two scenarios. Verified
  against ground truth: `FormSchemaConsistency.check`
  (`backend/src/main/scala/com/helio/domain/panels/FormSchemaConsistency.scala:20-34`) today only
  iterates `config.fields`, so a new rule checking the *declaration* for `occurred_at`/`value`
  independent of `config.fields` is a genuinely new code path, not already covered — the fix is real
  and structurally sound. Confirmed `DatasetFieldDeclaration` (`DataSource.scala:168-173`) has a
  `required: Boolean = false` field, matching the spec's "declared `required: true` is rejected"
  scenario. Confirmed `FormSubmission.buildRow`'s existing (i) unconfigured-key check
  (`values.keySet.diff(configuredNames)`) and (vii)/(viii) declared-order row-build
  (`FormSubmission.scala:59-61, 128-141`) are exactly the mechanism task 1.3 needs to special-case for
  `occurred_at`/`value` injection, and confirmed `DatasetRowValidator.scala:147` really does reject a
  `JsNull` cell for a `required` declared field — so the failure mode design.md now closes
  (a required-but-never-configured `occurred_at`/`value` column previously producing a silent
  `JsNull`/validation-reject) was real, and the new rule closes it. Fixed as claimed.
- **Round-1 fix 3 (nonexistent schema file citation):** confirmed `schemas/panels/panel.schema.json`
  has the `FormFieldConfig.properties.control.enum` at the schema file's line ~211-213 (`"control":
  {"type": "string", "enum": [...]}` starting at line 211 in the current file) — `tasks.md` §3.1 now
  cites this correctly instead of the nonexistent `form-panel.schema.json`. Fixed.

### New issue found on this fresh pass

The fix for round-1 issue #2 added two new spec scenarios to
`specs/counter-event-row-model/spec.md`'s new requirement ("A counter field can only be bound to a
dataset that structurally supports the row shape"):

- "Binding a counter to a dataset missing `occurred_at` is rejected"
- "Binding a counter to a dataset with a required `value` is rejected"

`tasks.md` §1 gained task 1.5 to *implement* the `FormSchemaConsistency.check` extension these
scenarios describe, but no task in §2 (or anywhere else) *verifies* it — grepped `tasks.md` for
`FormSchemaConsistency`/`reject`/`Left` and the only hits are task 1.5's own implementation text and
a reference inside task 1.3's prose. This is the identical gap class as round-1 issue #1 (a spec
scenario with no matching verification task), just reintroduced by the very fix meant to close a
different gap: 2.1–2.5 cover append-not-mutate/rapid-submission/ordering/aggregate/no-UPDATE, and 2.7
(new) covers the time-series Output scenario, but nothing covers "reject a counter bound to a
structurally-unsupporting dataset."

### Verdict: REFUTE

### Change Requests

1. **Add a verification task for the new `FormSchemaConsistency` rejection rule.** Add a task (e.g.
   §2.8, or fold into §1.5) asserting: (a) a counter-configured form config checked against a
   declaration missing `occurred_at` returns `Left` naming the missing field, and (b) a
   counter-configured form config checked against a declaration where `value` is declared `required:
   true` returns `Left`. This directly traces to `specs/counter-event-row-model/spec.md`'s two new
   scenarios under "A counter field can only be bound to a dataset that structurally supports the row
   shape," which currently have no covering task.

### Non-blocking notes

- All three round-1 change requests are genuinely and correctly addressed; none introduced a
  regression or contradiction elsewhere in the design (checked Decision 2/3/4, the risks section, and
  both spec deltas for consistency with the new Decision 3a failure-mode text — no conflict found).
- The design's claim that `value` may still be client-supplied (Decision 2/3a) despite
  `form-panel-submit/spec.md`'s "no raw `value` ... is ever accepted from the client for that field"
  is not a contradiction on inspection: the spec requirement scopes "that field" to the counter
  control's own configured `sourceField` (e.g. `delta`), while `value` arrives under a separate,
  non-configured `values["value"]` key that task 1.3 explicitly excludes from the unconfigured-field
  rejection path. Worth a one-line clarifying note in the spec if a future reader trips on this, but
  not blocking.
