## ADDED Requirements

### Requirement: Analyze response names the caller's access role

The full (non-concise) `GET /api/pipelines/:id/analyze` response SHALL carry a required top-level `callerRole` field
whose value is `owner` when the caller owns the pipeline, `editor` or `viewer` when the caller holds that grant, and
which depends on permission only (never on step validity, cost, or run budget). The committed analyze response schema
SHALL declare it, and both server and client SHALL validate against that schema.

#### Scenario: Editor on a pipeline with an invalid step
- **WHEN** an editor grantee analyzes a shared pipeline one of whose enabled steps has a validation error
- **THEN** `callerRole` is `editor` while `costVerdict.canRun` is false

#### Scenario: Owner and viewer
- **WHEN** the owner and a viewer grantee analyze the same pipeline
- **THEN** their `callerRole` values are `owner` and `viewer`
