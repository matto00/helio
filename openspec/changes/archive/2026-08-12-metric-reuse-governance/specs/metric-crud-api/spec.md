## MODIFIED Requirements

### Requirement: Delete metric
`DELETE /api/metrics/:id` SHALL delete the metric when owned by the caller and return
`204 No Content` with an `X-Unbound-Panel-Count` response header carrying the number of panels that
were bound to the metric at deletion time (and are therefore unbound via `ON DELETE SET NULL`); SHALL
return `404 Not Found` when the metric does not exist or is owned by a different caller.

#### Scenario: Owner deletes their own metric
- **WHEN** the caller DELETEs a metric they own
- **THEN** the response is `204 No Content` and the metric no longer appears in subsequent list/get calls

#### Scenario: Non-owner cannot delete another user's metric
- **WHEN** the caller DELETEs a metric owned by a different user
- **THEN** the response is `404 Not Found` and the metric is not deleted

#### Scenario: Delete response reports the unbound panel count via header
- **WHEN** the caller DELETEs a metric that three panels are bound to
- **THEN** the response is `204 No Content` with an `X-Unbound-Panel-Count: 3` header
