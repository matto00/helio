# dashboard-change-signals Specification

## Purpose
Report, for dashboards the caller can access, when their content was last edited and when their panels last received new data, so the client can mark changed tabs and validate cached dashboard data.

## Requirements

### Requirement: Per-dashboard change times

`GET /api/dashboard-changes?ids=<comma-separated ids>` SHALL return `{serverNow, items: [{dashboardId, contentUpdatedAt, dataUpdatedAt, outputs: [{outputId, dataUpdatedAt}]}]}` for the requested dashboards the caller can read (owned or shared). `contentUpdatedAt` SHALL be the later of the dashboard's `last_updated` and the latest `last_updated` of its panels. `dataUpdatedAt` SHALL be the latest `captured_at` in the output history of any Output bound to one of its panels that the caller can access, or `null` when there is none; `outputs` SHALL list each distinct accessible bound Output with its own latest `captured_at` (or `null`). Ids the caller cannot read, or that do not exist, SHALL be omitted (never an error, so the response reveals nothing about them). More than 20 ids, an empty list, or an empty id SHALL return `400`. Unauthenticated calls SHALL return `401`. Contract: `schemas/dashboards/dashboard-changes-response.schema.json`. Access SHALL be enforced by row-level security for the caller.

#### Scenario: Owned dashboard

- **WHEN** A requests her dashboard D whose panel's Output was captured at T
- **THEN** the item for D has `dataUpdatedAt` T and `contentUpdatedAt` no earlier than the dashboard's own `last_updated`

#### Scenario: Another user's private dashboard is omitted

- **WHEN** B requests A's unshared dashboard D
- **THEN** the response is 200 with no item for D

#### Scenario: Stays fast with deep history

- **WHEN** a dashboard has 12 bound Outputs each with at least 500 history points
- **THEN** the data query reads one history row per Output via the index and completes in under 20ms on the dev database, both for the owner and for a dashboard-only grantee without pipeline access

#### Scenario: Too many ids

- **WHEN** the caller requests 21 ids
- **THEN** the response is 400

### Requirement: Which writes count as a content change

Creating, duplicating, or deleting a panel, and editing the dashboard's name, appearance or layout, SHALL advance the dashboard's `contentUpdatedAt`; editing a panel's title, appearance or configuration SHALL advance it through that panel's `last_updated`. A one-time layout repair SHALL NOT advance it. A succeeded real pipeline run that records output history for a bound Output SHALL advance `dataUpdatedAt`; a dry run or failed run SHALL NOT.

#### Scenario: Panel delete advances content time

- **WHEN** a panel on D is deleted
- **THEN** D's `contentUpdatedAt` is later than before the delete
