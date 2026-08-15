## ADDED Requirements

### Requirement: A successful patch-set application SHALL be journaled with its prior state
`PatchSetApplyService.apply` SHALL persist an owner-scoped application record — every applied edit's
target kind, op, prior state, and resulting state — whenever the response reports no `failure`, and
SHALL persist nothing when a `failure` is present. The response SHALL carry an additive
`applicationId` field, present exactly when a record was journaled.

#### Scenario: A fully successful apply is journaled
- **WHEN** `POST /api/patch-sets/apply` returns a response with no `failure`
- **THEN** the response includes a new `applicationId`, and an owner-scoped application record
  exists containing every edit's target/op/prior/resulting state

#### Scenario: A partially rolled-back apply is not journaled
- **WHEN** `POST /api/patch-sets/apply` returns a response with a `failure` present (a mid-set edit
  failed and prior edits were compensated)
- **THEN** the response's `applicationId` is absent, and no application record is created

#### Scenario: A caller that ignores applicationId sees no behavior change
- **WHEN** `POST /api/patch-sets/apply` is called by a client that does not read the new
  `applicationId` field
- **THEN** every other field and every existing status code the response already returns is
  byte-for-byte unchanged from before this change

### Requirement: A journaled panel edit SHALL also capture a raw, unmaterialized config snapshot, journal-only
The journal SHALL, for a `panel` `update` edit only, additionally capture the panel's raw
(unmaterialized) post-apply config — the same value a bare, non-metric-resolving read of that panel
would return — distinct from the materialized `resultingState` already captured for every kind. This
raw config SHALL exist only in the journal, never as a field on `EditOutcome` or anywhere in the
`POST /api/patch-sets/apply` response body.

#### Scenario: A metric-bound panel's journaled raw config differs from its materialized response
- **WHEN** a panel edit updates a `MetricPanel` bound to a `metricId`
- **THEN** the journal's raw config for that edit carries the panel's own stored field values, not
  the bound metric's currently-effective values that the same edit's materialized `resultingState`
  carries

#### Scenario: The raw config never appears on the apply response
- **WHEN** `POST /api/patch-sets/apply` successfully applies a panel update edit
- **THEN** the response's corresponding `EditOutcome` has exactly the same fields it had before this
  change — no raw-config field is present anywhere in the response body

