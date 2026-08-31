## MODIFIED Requirements

### Requirement: Atomic dashboard-contents replace
`PUT /api/dashboards/:id/contents` SHALL replace ALL panels on an existing dashboard the caller may edit
(owner or editor-grantee, mirroring `PATCH /api/dashboards/:id`) with a supplied panel set, atomically: on
success every prior panel is gone and every supplied panel exists; on any failure NO panel is deleted or
created and the prior panel set remains exactly as it was. Panel resolution is against Outputs (for
`kind = output` panels) rather than against DataTypes/companion types; the prior companion-DataType
exclusion rule no longer applies since companion types do not exist.

#### Scenario: Successful replace
- **WHEN** the owner PUTs a valid `{ panels: [...] }` payload to an existing dashboard's `/contents`
- **THEN** the response is 200 with the rebuilt dashboard and its new panel set (same shape as
  apply-proposal/import), and the old panels no longer exist

#### Scenario: Validation failure leaves the dashboard untouched
- **WHEN** the payload's panel at index 2 has an invalid `kind` or is missing a required `outputId`
- **THEN** the response is 400 naming panel 3 by title/index, and the dashboard's panel set (both rows and
  visible content) is byte-for-byte unchanged from before the request

#### Scenario: Binding rejected — pipeline-only rule
- **WHEN** a supplied panel's `outputId` does not resolve to an accessible Output
- **THEN** the response is 400 and no panels are deleted or created, identical in shape to the same rejection
  on `POST /api/panels`

#### Scenario: Cross-tenant dashboard is not replaceable
- **WHEN** a caller who is neither the owner nor a grantee of the target dashboard issues the request
- **THEN** the response is 404 (no existence leak), and no panels belonging to the other owner are touched

#### Scenario: Live dashboard never observably empty
- **WHEN** a replace-contents call is in flight
- **THEN** a concurrent read of the dashboard's panels returns either the full old set or the full new set,
  never a partial/empty set

#### Scenario: Overlapping replace-contents calls on the same dashboard
- **WHEN** two replace-contents calls for the same dashboard overlap
- **THEN** the two transactions serialize (Postgres row-lock on the panel delete) and the last call to commit
  determines the final panel set; the earlier call still returns 200 for the write it made, which is then
  superseded
