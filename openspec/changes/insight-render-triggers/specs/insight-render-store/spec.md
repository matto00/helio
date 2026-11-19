## MODIFIED Requirements

### Requirement: Insight render store
The system SHALL store each insight render attempt in `output_insights` with its Output, pipeline, optional run id,
trigger (`on_run`, `daily`, `manual`, `pin`), status (`ok`, `failed`, `skipped_quota`, `skipped_unchanged`,
`skipped_budget`), markdown, citations, input digest, model, token counts, cost in micros and creation time. An `ok`
row SHALL carry markdown. Repeated attempts with no model call and the same status as the Output's newest attempt
(for `failed`, only when that attempt also has no model) SHALL be merged into that attempt, refreshing its creation
time, trigger, run id and input digest, instead of adding a row. Model, token counts and cost SHALL be null on every
row that made no model call. Deleting an Output SHALL delete its insight rows. Row-level security SHALL admit a row only
to a role that can access its pipeline.

#### Scenario: Output delete cascades
- **WHEN** an Output with insight rows is deleted
- **THEN** no `output_insights` row for that Output remains

#### Scenario: RLS as the non-bypassing app role
- **WHEN** the `helio_app` role selects from `output_insights` as a user who neither owns nor is granted the pipeline
- **THEN** zero rows are returned, and an insert for that pipeline is refused

#### Scenario: No-send failure never inherits model data
- **WHEN** the newest attempt is a `failed` row with a model, tokens and cost, and the next attempt fails without a send
- **THEN** a new `failed` row with null model, tokens and cost is inserted and the earlier row is unchanged

### Requirement: Authenticated insight read
`GET /api/outputs/:id/insight` SHALL return the newest `ok` render (or null) and the newest attempt of any status (or
null) for an `insight` Output the caller can read. `GET /api/outputs/:id/insight/history` SHALL return attempts newest
first, bounded by `limit` (1 to 100, default 30) and optional `since`. A caller who cannot read the Output, an unknown
id and a non-insight Output SHALL all get the same 404. Reads SHALL never create, regenerate or modify a render.
Model, token counts, `costMicros`, `runId` and `inputDigest` SHALL be present only for the pipeline owner and `editor`
grantees; a `viewer` grantee SHALL get every other field and none of these. The insight read SHALL carry `canRefresh`, true only for the pipeline owner and editors. For a `viewer`, every
`status` of
`skipped_quota` or `skipped_budget` SHALL be reported as `not_updated`; the owner and editors SHALL see the real status.

#### Scenario: Non-grantee indistinguishable from unknown id
- **WHEN** a user with no access requests an existing insight Output's insight
- **THEN** the response is 404 with the same body as for a random unknown id

#### Scenario: Latest good render survives a failed attempt
- **WHEN** the newest attempt is `failed` and an older attempt is `ok`
- **THEN** `render` is the older ok row and `lastAttempt.status` is `failed`

#### Scenario: Cost fields by role
- **WHEN** the owner, an editor grantee and a viewer grantee each read the insight and its history for a render whose
  row has every column populated
- **THEN** the owner and editor responses carry `model`, token counts and `costMicros`, and the viewer responses carry
  none of them nor `runId` or `inputDigest`

#### Scenario: Viewer sees a neutral status for quota and budget skips
- **WHEN** the newest attempt is `skipped_quota` (and, separately, `skipped_budget`) and the owner, an editor grantee and
  a viewer grantee read the insight and its history
- **THEN** the owner and editor see the real status, and the viewer sees `not_updated` in `lastAttempt` and in every
  history item that carries either status

#### Scenario: Read service has no model client
- **WHEN** the read service's constructor parameters are inspected
- **THEN** they contain no model client, renderer, Claude client or service that holds one
