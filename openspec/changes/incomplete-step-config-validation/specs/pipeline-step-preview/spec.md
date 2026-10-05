## ADDED Requirements

### Requirement: Previewing a step whose closure has invalid step configuration returns a named 422
When a step preview (`GET /api/pipelines/:id/steps/:stepId/preview`) or an Output preview
(`POST /api/pipelines/:id/preview`) fails because a step in the executed closure has missing, empty or invalid
step configuration, the endpoint SHALL refuse the preview with `422 Unprocessable Entity` and SHALL NOT return an empty
row set as though the step produced no rows. The body SHALL carry the existing `message` field unchanged, plus
`code` equal to `"STEP_CONFIG_INVALID"`, `stepId` and `stepKind` of the failing step, and `reason`, the step's own
problem description without any step id or lane-path prefix. A step-configuration problem is a step kind's
required-configuration check or an invalid configuration value detected while the step evaluates. Failures caused by
the data (for example no parsable timestamps), by an unresolved lane or source reference, or by an external provider
are NOT step-configuration problems and SHALL keep their existing status and body.

#### Scenario: upsertsource with an empty new-source name
- **GIVEN** a saved `upsertsource` step whose target is `{kind: "newSource", name: ""}`
- **WHEN** that step is previewed
- **THEN** the response is 422 with `code` `"STEP_CONFIG_INVALID"`, that step's `stepId`, `stepKind`
  `"upsertsource"`, and `reason` `'upsertsource' step requires a non-empty 'target.name' for a new source`

#### Scenario: upsertsource with an absent new-source name
- **WHEN** an `upsertsource` step config whose target is `{kind: "newSource"}` with no `name` field is submitted to
  the step create endpoint
- **THEN** it is rejected with 422 naming the missing `name`, and no ERROR-level log event is emitted
- **AND WHEN** such a config is nevertheless already stored and the step is previewed
- **THEN** the step listing still loads and the preview response is the named 422 with `reason`
  `'upsertsource' step requires a non-empty 'target.name' for a new source`

#### Scenario: The failing step is an ancestor of the previewed step
- **GIVEN** a `compute` step with an empty `column` and a child `select` step
- **WHEN** the child step is previewed
- **THEN** the response is the named 422 whose `stepId` is the compute step's id, not the previewed step's

#### Scenario: A data failure is not reported as a configuration problem
- **GIVEN** a saved `datebucket` step whose field holds no parsable dates
- **WHEN** it is previewed
- **THEN** the response is 422 without `code` `"STEP_CONFIG_INVALID"`, as before

#### Scenario: A step-config failure raised during evaluation
- **GIVEN** a saved `fillnull` step with strategy `constant` and no `value`
- **WHEN** it is previewed
- **THEN** the response is the named 422 with `stepKind` `"fillnull"`

### Requirement: The step card preview tray shows the named reason
When a step preview fails with `code` `"STEP_CONFIG_INVALID"`, the StepCard preview tray SHALL render the `reason`
inline, without the step id or lane path. When `stepId` names a different (upstream) step, the tray SHALL say that an
upstream step of kind `stepKind` is not fully configured, followed by the reason. Other preview errors SHALL keep
their existing rendering.

#### Scenario: Own step incomplete
- **WHEN** the preview of a step fails with `STEP_CONFIG_INVALID` naming that same step
- **THEN** the tray shows the reason text and no UUID

#### Scenario: Upstream step incomplete
- **WHEN** the preview fails with `STEP_CONFIG_INVALID` naming an ancestor step
- **THEN** the tray attributes the problem to the upstream step's kind and shows the reason
