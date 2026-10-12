## Context

See proposal.md (Why). Current state, verified in Setup (`.concertino/runs/HEL-1514/evidence/premise-validation.md`):
- `stepCardFieldHandlers.ts:79` persists casts with `persist({ casts: next })`; `useStepCardPersist.persist` only
  surfaces a rejection when `captureErrors` is true (HEL-1416 passes it for fillnull/window/pivot).
- `PipelineStepWrites.updateStep` runs `PipelineStep.rawConfigProblem` on the full map; `CastStep.writeConfigProblem`
  422s any target outside `SupportedTargets`, naming field and target.
- At run time a legacy target is passthrough (`CastStep.castValue` `case _ => v`), i.e. identical to "keep as is",
  NOT to `string` (which stringifies numbers).
- `CastFieldsConfig` renders one row per analyze `inputSchema` column only; a stored key absent from the schema has no
  row today, so it could never be cleared.
- `PipelineStepWrites.duplicateStep` runs editor access + `rawConfigProblem` only; create runs the secondary-source
  ownership check (caller), `validateLaneReference`, and `upsertOwnershipCheckF` (pipeline owner).

## Goals / Non-Goals

Goals: no cast edit can look saved when it was rejected; a legacy target is always clearable from the editor; every
duplicate-vs-create gap is either closed red-first (validity) or escalated with a repro (authorization).
Non-goals: see proposal.md. No other step kind's error capture changes.

## Decisions

**D1. Cast persists with `captureErrors = true`.** Same mechanism as HEL-1416; the existing `saveError` /
`saveErrorIsValidation` state is reused. The cast branch of `StepOpEditor` does not render `saveError` today, so
follow `FillNullConfig`: `CastFieldsConfig` takes `saveError`/`saveErrorIsValidation` props and renders the shared
`InlineError` (with a `useId` id) inside the component. The per-row invalid mark comes from the stored target (D2); on a
validation 422 the unsupported rows are also described by the error (hint id and error id combined, as in
`FillNullConfig`). Alternative rejected: client-side pre-validation that blocks the PATCH. It would
duplicate the server rule and still miss a rejection for any other reason.

**D2. Row hint (owner ruling: `row-hint`).** For a row whose stored target is unsupported, pass `ariaInvalid` and
`ariaDescribedBy` to the shared `Select` (HEL-1084/HEL-1490 props) and render a hint under the select with copy: "No
longer supported. Choose a type, or keep as is to keep today's behaviour." Hint ids come from `useId` (several cast
cards can be on one page). Styling follows the in-feature hint precedent `pipeline-detail-page__compute-fields-hint`
with existing tokens; no new colour. There is no new button and no automatic rewrite.

**D3. Rows for stored keys outside the schema.** `CastFieldsConfig` renders `columns` followed by any `casts` key not
in `columns` (stable order: schema columns first, then remaining keys sorted). This is required for D2 to be possible
in all cases (otherwise an orphaned legacy key makes the step permanently unsaveable). Self-approved under the
`row-hint` ruling; it shows existing stored state and adds no new action. A stored key with a SUPPORTED target whose field
left the schema also gets a plain row (no invalid mark: it is valid and saveable); this is accepted.

**D4. Duplicate audit, decision rule.** For each of the three create checks, the executor builds the scenario in which
create rejects the config at the clone's position for that caller, and runs duplicate (ScalaTest, embedded Postgres):
- Lane (`validateLaneReference`): the clone's ancestors are the original's ancestors plus the original, so the only
  expected divergences are a lane target deleted after the original was written, or (via a trunk reorder) a lane
  target that became an ancestor (create's cycle error). The fix covers both. Validity gap: fix by running
  `validateLaneReference` in `duplicateStep` against the clone's prospective chain, red-first.
- Upsert target (`upsertOwnershipCheckF`, pipeline-owner identity): expected divergence is a target deleted or no
  longer a writable dataset. The acting identity does not change on duplicate, so this is validity: fix red-first by
  calling the same `upsertOwnershipCheckF`.
- Secondary-source ownership (caller identity): an editor grantee can duplicate a join/union/lookup referencing a
  source they do not own, which create and update reject. This is an authorization-check bypass. Do NOT fix it
  ahead of a ruling. As soon as task 1.2 has the repro (users, requests, statuses, and evidence on whether the clone
  widens data reach beyond the existing step), the executor returns ESCALATION, BEFORE tasks 2.x, because the answer
  can change scope. The orchestrator relays it to the owner. Then exactly one branch applies:
  - (a) Close: `duplicateStep` runs the same `secondaryDataSourceId` + `findByIdOwned(caller)` check, first among the
    reference checks (create's order), returning create's 404. The audit test goes red to green. The planner adds a
    requirement and scenario to the `pipeline-step-lifecycle` delta.
  - (b) Accept or defer: commit a characterization test that pins today's permissive behaviour, with a comment naming
    the ruling (and the spinoff ticket, if one is filed). No spec change.
If a scenario does not reproduce (e.g. deleting a lane target cascades), record the evidence, drop that scenario from
the `pipeline-step-lifecycle` delta, and do not add the check.

**D5. Check order in duplicate** after the HEL-1476 `rawConfigProblem` check, as in create: secondary-source (only
if branch (a)), lane, then upsert. This mirrors create,
so a clone fails with the same status and message create returns.

## Risks / Trade-offs

- [Error text shows the whole server message] → acceptable; it names the field and target, which is what the user needs.
- [D3 adds rows not backed by the schema] → only for keys that are already stored; "keep as is" removes them.
- [Duplicate becomes stricter] → it only rejects clones that create would reject and that would fail or dangle at run.

## Migration Plan

None. No schema, API shape or data change. Rollback is a revert.

## Planner Notes

- The owner answered `row-hint` on 2026-10-12 (escalation in the run's events.jsonl). The driver's "replace with
  string" example was corrected: legacy targets run as passthrough, so "keep as is" is the behaviour-preserving choice.
- Red-first is binding for D1 (hook/card test where the 422 shows), D2/D3 (CastFieldsConfig tests) and D4's validity
  fixes. Backend specs use `VerifiedEmbeddedPostgres.start`; sbt runs must show `[hel1468-guard]`.
- Affected e2e specs (at least `e2e/hel908-step-card-split.spec.ts` and any spec touching the cast card or step
  duplicate) must be run by the evaluator and final skeptic.
