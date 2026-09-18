## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/counter-event-row-model/spec.md`, `specs/form-panel-submit/spec.md`) fresh, in full, not from
  round 2's narrative.
- **Round-2 fix verified:** `tasks.md` §2.0 now exists and asserts both new
  `specs/counter-event-row-model/spec.md` scenarios under "A counter field can only be bound to a
  dataset that structurally supports the row shape":
  - (a) a counter-configured form config checked against a declaration missing `occurred_at` returns
    `Left` naming the missing field
  - (b) a counter-configured form config checked against a declaration where `value` is `required:
    true` returns `Left`
  The task wording traces 1:1 to the two spec scenarios' text. Fixed as claimed.
- Re-verified against ground truth that the rule being tested is genuinely new: read
  `backend/src/main/scala/com/helio/domain/panels/FormSchemaConsistency.scala:20-34` directly — `check`
  only iterates `config.fields` (`byName.contains(field.sourceField)`, `checkControlFitness`,
  `checkOptions`, `checkInitialValue`) and never inspects the declaration for fields not referenced by
  `config.fields`. A rule that rejects a counter binding based on what the *declaration* does or
  doesn't contain (`occurred_at`/`value` presence/required-ness), independent of `config.fields`, is
  not already covered by this code — task 1.5's planned extension and task 2.0's new verification are
  both real, not restating existing behavior.
- Checked task numbering: §2.0 sits before §2.1 in the file (unconventional but unambiguous — no
  duplicate/skipped numbers, no collision with an existing task).
- Re-swept for the same gap class (spec scenario with no covering task) across every requirement in
  both spec files: all requirements and their scenarios in `counter-event-row-model/spec.md` (append-
  not-mutate/rapid-submission → 2.1/2.2; occurred_at server-assigned + seq ordering → 2.3; structural
  binding rejection → 2.0; pipeline-derivable running total → 2.4; time-series Output → 2.7) and
  `form-panel-submit/spec.md` (valid delta accepted / non-numeric delta rejected → 1.2; client-supplied
  occurred_at ignored → 1.3) each trace to a tasks.md item. No orphaned scenario found.
- Re-checked the three round-1 fixes and the round-2 finding are still intact and not disturbed by the
  round-2→round-3 edit (task 2.7, the FormSchemaConsistency Decision 3a failure-mode text, and the
  `panel.schema.json` line citation in §3.1 are unchanged and still correct).
- No new contradictions found between proposal/design/tasks/specs on this fresh pass.

### Verdict: CONFIRM

### Non-blocking notes

- Task numbering (`2.0` preceding `2.1`) is slightly unconventional; purely cosmetic, does not affect
  traceability or execution order.
