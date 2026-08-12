# metric-usage-governance Specification

## Purpose
Lets a caller see which panels and dashboards a metric is bound to before deleting or deprecating it,
and communicates the impact of a delete (unbound panel count) so metric reuse stays safe and
observable as metrics get shared across more dashboards.
## Requirements
### Requirement: GET /api/metrics/:id/usage lists bound panels and dashboards

The system SHALL expose `GET /api/metrics/:id/usage`, owner-scoped (`findByIdOwned`, 404 when the
metric doesn't exist or isn't owned by the caller), returning `{ metricId, count, panels: [{ panelId,
panelTitle, dashboardId, dashboardName }] }` — one entry per panel whose `metricId` currently references
this metric, each carrying its owning dashboard's id and name.

#### Scenario: Metric with bound panels reports usage

- **WHEN** the owner calls `GET /api/metrics/:id/usage` for a metric two panels (on two different
  dashboards) are bound to
- **THEN** the response has `count: 2` and `panels` contains both panels' ids/titles with their
  respective dashboards' ids/names

#### Scenario: Metric with no bound panels reports empty usage

- **WHEN** the owner calls `GET /api/metrics/:id/usage` for a metric no panel is bound to
- **THEN** the response has `count: 0` and `panels: []`

#### Scenario: Usage query is owner-scoped

- **WHEN** a caller requests `GET /api/metrics/:id/usage` for a metric owned by a different user
- **THEN** the response is `404 Not Found`

#### Scenario: Usage query never returns another owner's panels

- **GIVEN** a metric owned by user A, bound to a panel owned by user A
- **WHEN** user A calls `GET /api/metrics/:id/usage`
- **THEN** the response never includes panels or dashboards owned by any other user, even if such a
  panel could theoretically reference the same metric id

### Requirement: DELETE /api/metrics/:id communicates the unbound panel count

`DELETE /api/metrics/:id` SHALL remain `204 No Content` on success (no breaking change to the existing
body-less contract) and SHALL additionally set an `X-Unbound-Panel-Count` response header carrying the
number of panels that were bound to the metric (and are therefore unbound via `ON DELETE SET NULL`) at
the moment of deletion.

#### Scenario: Deleting a metric with bound panels reports the count via header

- **WHEN** the owner deletes a metric that two panels are bound to
- **THEN** the response is `204 No Content` with an `X-Unbound-Panel-Count: 2` header

#### Scenario: Deleting an unbound metric reports zero via header

- **WHEN** the owner deletes a metric no panel is bound to
- **THEN** the response is `204 No Content` with an `X-Unbound-Panel-Count: 0` header

