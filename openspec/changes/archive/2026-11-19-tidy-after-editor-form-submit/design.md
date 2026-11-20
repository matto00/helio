## Context

See proposal.md - Why. Ground truth on main at 68255cf79:

- `PipelineRunService.recordUnrunnable` (`PipelineRunService.scala:213`) gained `triggeredByUserId: Option[UserId] =
  None` in HEL-1784 (daf40bfbf) and stores `Some(triggeredByUserId.getOrElse(user.id).value)`. Production callers:
  `PipelineProposalService.scala:608` (the applying user, acting for itself) and `PipelineSchedulerService.scala:263`
  (the pipeline owner, scheduled skip). Neither passes it. The auto-run path (the only path with a distinct triggerer,
  the V146 `triggered_by_user_id` use case) reaches `submit`, never `recordUnrunnable`.
- `PipelineRunEditorPersistenceSpec` "record the submitting user on a run recorded as unrunnable" already asserts the
  stored value is the acting user.
- `PanelService.formSchema` looks the panel up with `panelRepo.findById(panelId, Some(user))` and returns
  `NotFound("Panel not found")` on `None`; a non-form panel gets `400`. `ExistenceNotLeakedRoutesSpec` has rows for
  `POST /api/panels/{id}/submit` but none for `GET /api/panels/{id}/form-schema`.
- `FormSubmitEditorRlsSpec.scala:217-219` proves owner-keying through `pipeline_run_rate_window` (owner row > 0, editor
  row = 0). Archived HEL-1784 `design.md:237` and `tasks.md:37` say `countOwnerInFlightRealRunsInternal(owner)`
  instead (evaluation-1.md:76 explains why that count would read 0 after the run finishes).

## Goals / Non-Goals

**Goals:** drop the dead parameter with no behavior change; put form-schema under the leak sweep with a failable row;
make the archived wording true. **Non-Goals:** see proposal.md Non-goals.

## Decisions

- **D1 Drop the parameter, do not wire it.** The AC allows either. Wiring needs a caller with a triggerer other than the
  acting user; none exists, so passing it would be a test-only path. Dropping keeps the stored value byte-identical
  (`Some(user.id.value)`). Guard: the existing `PipelineRunEditorPersistenceSpec` unrunnable test; mutation shown red:
  store `None` (or another id) in `recordUnrunnable`'s `insertRun` -> that test fails. Alternative rejected: keep it with
  a comment (evaluation-1 allowed it, but a dead knob invites a wrong future caller).
- **D2 Row shape.** `Row("GET panel form-schema", HttpMethods.GET, "/api/panels/{id}/form-schema", Panel,
  Set("PanelService.scala"))`, `ownerControl = true` (the seeded panel is not a form, so the owner gets `400`, which is
  neither 404 nor 403 and proves the request reaches the guarded code). If the executor finds the owner control does
  not hold, it must say why and set `ownerControl = false` with a comment, as other rows do. The site set must keep the
  file-completeness guard green (PanelService.scala is already named by other rows).
- **D3 Red by mutation, recorded and committed before the row is final (C12).** Order: add the row; run the spec; then
  apply a leak mutation in `PanelService.formSchema` and show the new row red: (a) look the panel up truly unfiltered
  with `panelRepo.findByIdInternal(panelId)` (`PanelRepository.scala:130`) - NOT `findById(panelId, None)`, which is the
  anonymous public-only lookup and would still return `None` for the non-public seeded panel - so a foreign text panel
  answers `400` while an absent id answers `404`; and (b) the driver-suggested one, the `None` branch answering `403`,
  which fails the "foreign arm is exactly 404" anti-vacuity check. Mutation (b) also adds a `ServiceError.Forbidden(`
  producer to `PanelService.scala`, tripping the pinned producer count (4 to 5); the transcript must name the new row's
  failure separately from that pin's. Revert, show green. Transcripts go to `.concertino/scratch/HEL-1787/` and the red summary to
  `.concertino/runs/HEL-1787/evidence/`. Also show the row is genuinely new: the mutation must turn THIS row red, not
  only some other panel row (name the failing row in the transcript).
- **D4 Archived wording.** Replace the two `countOwnerInFlightRealRunsInternal(owner)` phrases with wording that names
  `FormSubmitEditorRlsSpec` "store the editor on the debounce row and fire the run as the owner..." and its
  `pipeline_run_rate_window` assertions (owner row present, editor row absent). Factual, nothing else in the archive
  changes. The new wording may add, in one clause, that the cap query (`ownerInFlightRealRunsQuery`) is
  owner-keyed by construction. evaluation-1.md and skeptic reports are historical records and stay untouched.

## Risks / Trade-offs

- Removing a defaulted parameter is source-compatible for every caller that does not name it; a compile catches any
  that does. Low risk.
- Editing an archived change is unusual; it is limited to two lines and justified by the ticket's AC.

## Planner Notes

- Self-approved: D1 (drop rather than wire), because no production caller has a distinct triggerer.
- Backend-only gates: `sbt testFull` scoped to the touched specs plus compile; no frontend/e2e impact expected.
