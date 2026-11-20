# HEL-1787: Tidy after HEL-1784: unused trigger parameter, form-schema row in the not-leaked spec, design wording

## Description

Three small leftovers from HEL-1784's review (evaluation-1.md suggestions 2-4, restated by skeptic-final-1.md item 4).
Follow-up of HEL-1784 (origin_kind: followup). Evidence: `.concertino/runs/HEL-1784/evidence/`; archived change
`openspec/changes/archive/2026-11-19-editors-submit-form-panels/`.

## Acceptance Criteria

- `recordUnrunnable` loses its unused `triggeredByUserId` parameter, or a caller passes it with a test showing the
  value is recorded.
- `ExistenceNotLeakedRoutesSpec` gets a row for `GET /api/panels/:id/form-schema` (a stranger and an unknown id get
  the same 404).
- The archived HEL-1784 design/tasks wording names the real proof that an editor's auto-run counts against the owner
  (the owner's rate-window row), not `countOwnerInFlightRealRunsInternal`.
