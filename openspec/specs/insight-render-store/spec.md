# insight-render-store Specification

## Purpose
Stores each insight render attempt in `output_insights` and serves it read-only to grantees and, allow-listed, to
public dashboard viewers, with per-tier retention on the scheduler tick.

## Requirements

### Requirement: Insight render store
The system SHALL store each insight render attempt in `output_insights` with its Output, pipeline, optional run id,
trigger (`on_run`, `daily`, `manual`, `pin`), status (`ok`, `failed`, `skipped_quota`, `skipped_unchanged`,
`skipped_budget`), markdown, citations, input digest, model, token counts, cost in micros and creation time. An `ok`
row SHALL carry markdown. Deleting an Output SHALL delete its insight rows. Row-level security SHALL admit a row only
to a role that can access its pipeline.

#### Scenario: Output delete cascades
- **WHEN** an Output with insight rows is deleted
- **THEN** no `output_insights` row for that Output remains

#### Scenario: RLS as the non-bypassing app role
- **WHEN** the `helio_app` role selects from `output_insights` as a user who neither owns nor is granted the pipeline
- **THEN** zero rows are returned, and an insert for that pipeline is refused

### Requirement: Authenticated insight read
`GET /api/outputs/:id/insight` SHALL return the newest `ok` render (or null) and the newest attempt of any status (or
null) for an `insight` Output the caller can read. `GET /api/outputs/:id/insight/history` SHALL return attempts newest
first, bounded by `limit` (1 to 100, default 30) and optional `since`. A caller who cannot read the Output, an unknown
id and a non-insight Output SHALL all get the same 404. Reads SHALL never create, regenerate or modify a render.

#### Scenario: Non-grantee indistinguishable from unknown id
- **WHEN** a user with no access requests an existing insight Output's insight
- **THEN** the response is 404 with the same body as for a random unknown id

#### Scenario: Latest good render survives a failed attempt
- **WHEN** the newest attempt is `failed` and an older attempt is `ok`
- **THEN** `render` is the older ok row and `lastAttempt.status` is `failed`

#### Scenario: Read service has no model client
- **WHEN** the read service's constructor parameters are inspected
- **THEN** they are exactly the Output repository, the insight repository and the execution context, so no model
  client, renderer, Claude client or service that holds one can be reached

### Requirement: Public insight read
`GET /api/dashboards/:d/panels/:p/insight` SHALL authorize the dashboard with the same sharing-aware dashboard ACL and
`?token=` parameter as the public history route, before resolving the panel, and SHALL return only the
newest `ok` render's markdown, creation time and citations reduced to `id`, `field`, `number`, `date`, `capturedAt`,
`isPct` and an optional `panelId`. `panelId` SHALL be present only when a panel on the same dashboard is bound to the
cited Output, and SHALL then name one such panel, chosen deterministically. It SHALL NOT expose cost, model, token
counts, run id, input digest, trigger, attempt status or cited Output ids.

#### Scenario: Private dashboard refused
- **WHEN** an anonymous caller or a signed-in stranger requests the insight of a panel on a private dashboard
- **THEN** the response is 404 with the same body as for an unknown dashboard, while a valid share token gets 200

#### Scenario: Panel from another dashboard
- **WHEN** the panel id belongs to a different dashboard than the one in the path
- **THEN** the response is 404

#### Scenario: Public projection omits internal fields
- **WHEN** the public route serves a render whose row has every column populated
- **THEN** the response and its schema contain no cost, model, token, run-id, digest or outputId field

#### Scenario: Placed and unplaced citations
- **WHEN** a render cites one Output that is placed on the dashboard and one that is not, and the cited Output is
  also placed on another dashboard
- **THEN** the first citation's `panelId` names the panel on the requested dashboard and the second has no `panelId`

### Requirement: Insight retention
The scheduler-tick retention pass SHALL delete insight rows older than the pipeline owner's tier history age, except
each Output's newest `ok` row and newest attempt.

#### Scenario: Last good render kept past the age limit
- **WHEN** an Output's only `ok` row is older than its tier's age limit
- **THEN** the retention pass keeps it and deletes older non-latest rows
