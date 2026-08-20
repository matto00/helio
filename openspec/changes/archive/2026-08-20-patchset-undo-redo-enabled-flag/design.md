## Context

`PatchSetUndoInverse.scala` builds full-overwrite inverse requests (`UpdatePipelineStepRequest`/
`CreatePipelineStepRequest`) from the raw, persisted `PipelineStepResponse` JSON captured in the
apply journal (`PatchSetApplicationRepository`). `fullPipelineStepInverse` (used for a full revert of
an `update` edit) and `pipelineStepCreateRequestFromResponse` (used for the delete-and-recreate path)
currently read only `type`/`config`/`position` off that JSON — `enabled` (HEL-412) is dropped, so a
recreated/reverted step always comes back `enabled: true` regardless of the captured state.

The file's own doc comment already states design.md D5's discipline for this file family: "every
field populated from the captured prior/response state — never just the fields the forward edit
changed." `enabled` was simply missed when HEL-412 landed after this file's own inverse-builders were
written — the same class of gap `fullConfigInverse`'s null-default handling already exists to close
for Option config fields (HEL-406).

## Goals / Non-Goals

**Goals:**
- `fullPipelineStepInverse`/`pipelineStepCreateRequestFromResponse` read `enabled` off the persisted
  JSON and propagate it, matching D5's full-overwrite discipline.
- Absent `enabled` key (legacy JSON from before HEL-412) restores to `true` — no behavior change for
  old records.
- Regression coverage in `PatchSetUndoInverseSpec` (unit, JSON-only) plus, if the existing
  `PatchSetUndoServiceSpec` already runs a full delete/recreate or update/revert pipeline-step
  round-trip against a real DB-backed step, extend it to assert `enabled` there too.

**Non-Goals:**
- `PatchSetApplyRollback.scala`'s own `fullPipelineStepInverse`/`pipelineStepCreateRequestFromPrior`
  (the within-a-single-apply-call compensation/rollback path) — reads a domain `PipelineStep`, not
  the persisted JSON this ticket touches, and is not named in HEL-705's scope. It appears to have an
  analogous gap; flagged as a delivery-time follow-up triage rather than fixed here (this ticket's own
  Non-goals in proposal.md).
- No wire/schema change — `enabled` already exists on both request types (HEL-412).
- No frontend change — this is a pure backend correctness fix for an existing, already-wired field.

## Decisions

**D6 (this ticket). Explicit `Some(...)` default, not `None`, on the `UpdatePipelineStepRequest.enabled`
full-overwrite inverse.** `UpdatePipelineStepRequest.enabled`'s own doc comment states "absent means no
change" for the ordinary PATCH-request contract — but `fullPipelineStepInverse` is a full-overwrite
inverse builder (D5), not an ordinary patch: every other field (`type`/`config`/`position`) is already
always populated with `Some(...)` from the captured state, never left `None` to mean "no change."
Leaving `enabled` as `None` here would silently leave the LIVE (post-forward-edit) step's current
enabled/disabled state in place on revert — exactly the same class of bug `fullConfigInverse`'s
explicit-null-default already exists to close for Option config fields (HEL-406). So: extract
`enabled` from the persisted JSON, defaulting to `true` when the key is absent (legacy record), and
always wrap in `Some(...)`.

*Alternative considered*: leave `enabled = None` when the JSON is missing the key (to mean "don't
touch it") and only set `Some(...)` when present. Rejected — a present-but-since-toggled live step
would then survive a revert with its own current (wrong) `enabled` value, which is precisely the
defect this ticket exists to close; "absent → true" is the create-request's own established contract
for the SAME "no `enabled` info available" case (D-none, HEL-412), reused here for consistency rather
than inventing a second meaning for absence.

**D7. `CreatePipelineStepRequest.enabled` passes through as `Option[Boolean]`, not defaulted eagerly.**
`CreatePipelineStepRequest.enabled: Option[Boolean] = None` already means "created enabled" (`true`)
per its own doc comment (HEL-412) — so `fields.get("enabled").map(_.convertTo[Boolean])` is sufficient
and correctly self-documents "no `enabled` info in the persisted JSON" as `None`, exactly matching the
create endpoint's existing default-true behavior, without this file re-stating the default itself.

## Risks / Trade-offs

[Silent behavior drift if a future format change renames/removes the raw `"enabled"` JSON key without
updating these two helpers] → guarded by `PatchSetUndoInverseSpec`'s new regression coverage (same
guard rationale the file's own doc comment gives for `optionalConfigFieldNames` staying in sync with
`PatchSetApplyRollback`'s independent copy).

[The identical gap in `PatchSetApplyRollback.scala`'s own pipeline-step inverse builders remains
unfixed] → out of scope per this ticket's stated boundaries (proposal.md Non-goals); flagged for a
delivery-time follow-up triage, not silently left undocumented.

## Migration Plan

None — pure code fix, no data migration, no wire/schema change, no deploy-order dependency.

## Open Questions

None.

## Post-review fold-in (2026-08-19)

Task 2.6 adds DB-backed `enabled` coverage for the full-revert path (`fullPipelineStepInverse`, via
`restorePipelineStepUpdate`), symmetric with 2.4's delete-and-recreate coverage. No new design
decision — same pattern as the actual 2.4/5.3c edit (a minimal, in-place extension of a pre-existing
case, not a new test block): the existing 5.3a case in `PatchSetUndoServiceSpec.scala` already
exercises this exact path, so 2.6 extends it in place (seed the step disabled + one restored-value
assertion) rather than adding a new, duplicative test — `PatchSetUndoServiceSpec.scala` is already
past CONTRIBUTING.md's ~400-line "propose a split rather than adding to it" threshold (504 lines), so
a minimal in-place edit is the only sound choice here, not just a style preference
(skeptic-design-2.md CR1). Triaged `fold-in` (small effort, high file overlap) from a final-gate
skeptic non-blocking note; user-approved before merge.

## Planner Notes

Self-approved: no new external dependency, no architectural change, no breaking API change. A small
spec delta was added to `patch-set-undo` (a new scenario under the existing "restored to its
pre-apply state" requirement, naming the `enabled` field explicitly) rather than a wholly new
requirement — the current behavior is a defect against that requirement's existing general language,
not new behavior; the delta just makes the already-intended guarantee testable per-field. No Planning
ESCALATION raised.
