# HEL-1532: Close the remaining backend/chart timestamp-parse disagreements outside HEL-1502's shapes

## Description

origin_kind: followup — origin_ticket: HEL-1502 (PR #985).

HEL-1502 made the chart time axis parser (`parseChartInstant`, `frontend/src/utils/chartTimeAxis.ts`) and the backend
shared parser (`TimestampParsing.parseInstant`) agree case by case on every shape it added, through
`shared-test-fixtures/chart-timestamp-parsing.json`. The final-gate skeptic fuzzed 209,731 generated inputs and found
existing disagreements on code paths HEL-1502 did not touch.

Backend-only (accepted by `Instant.parse`/`OffsetDateTime.parse`/the space-separated local reader, rejected by the chart):

- trailing-dot fraction (`2026-07-01T12:00:00.Z`)
- leap second (`23:59:60Z`)
- extended years (`+12026-07-01T…`)
- `2026-02-29 12:00` silently clamped to 28 Feb by the space-separated local reader (SMART resolution); cast still keeps it
- `2026-07-01 24:00` accepted as the next midnight

Chart-only:

- year `0000`
- a fraction without seconds on space-separated local times (`2026-07-01 12:00.5`)

Decide per case which side is right (the HEL-1502 `bound-epoch-range` and strict-`MM/dd/yyyy` rulings suggest
rejecting fabricated or clamped dates), then pin each case in the shared fixture.

Also tidy up, from HEL-1502 review:

- `chartTimeAxis.test.ts` asserts a minimum of 98 fixture cases and the backend asserts 99; align them.
- `DateBucketCharacterisationSpec`'s `MM/dd/yyyy` row now sits in the "unchanged" group although its output changed.
- Add step-level tests for the bracketed-id `date_trunc("hour")` scenario and the epoch-bound bucketing positives.

## Acceptance Criteria

- Every disagreement class above has a decision recorded in design.md and at least one case pinned in the shared
  fixture; backend parity spec and chart test both pass over every fixture case (same instant or both null).
- The fixture-count minimum is the same number on both sides.
- The `MM/dd/yyyy` characterisation row sits in a group that says its output changed.
- Step-level tests exist for `date_trunc("hour", …)` over bracketed-id inputs (compute step) and for the epoch-bound
  positives through the datebucket step.

## Owner context (HEL-1502 rulings, binding)

`accept-postgres-offsets`, `widen-parser`, `iso-instant-both`, `bound-epoch-range`. This run is unattended
(overnight rules): any parse-vs-null choice not decided by those rulings is an ASSUMED PRODUCT CALL, recorded and
surfaced in an OWNER REVIEW section of the PR, which is parked unmerged.
