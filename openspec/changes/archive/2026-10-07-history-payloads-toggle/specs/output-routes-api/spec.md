## ADDED Requirements

### Requirement: Output responses report history-payload availability
Every Output returned by `GET /api/pipelines/:id/outputs`, `POST /api/pipelines/:id/outputs`, `GET /api/outputs/:id`,
`PATCH /api/outputs/:id` and `GET /api/outputs` SHALL carry a read-only boolean `historyPayloadsAvailable`. It SHALL be
true exactly when the owner of the Output's pipeline is on a tier whose payload retention keeps at least one run
(runs > 0 and age > 0). It SHALL be derived from the pipeline owner's tier, never from the requesting user's tier,
and SHALL NOT be settable by a client. It SHALL be resolved only for Outputs the caller is already authorized to read.

#### Scenario: Free-tier pipeline owner
- **WHEN** the pipeline's owner is on the free tier (default retention 0 runs)
- **THEN** each of that pipeline's Outputs is returned with `historyPayloadsAvailable: false`

#### Scenario: Beta or owner tier pipeline owner
- **WHEN** the pipeline's owner is on the beta or owner tier
- **THEN** each of that pipeline's Outputs is returned with `historyPayloadsAvailable: true`

#### Scenario: Cross-tier editor grantee
- **WHEN** a free-tier editor grantee reads or patches an Output on a beta-owned pipeline
- **THEN** the response carries `historyPayloadsAvailable: true` (the pipeline owner's tier, not the caller's)

#### Scenario: Client cannot set it
- **WHEN** a PATCH body's `config` includes `historyPayloadsAvailable`
- **THEN** the top-level response field still reflects the pipeline owner's tier
