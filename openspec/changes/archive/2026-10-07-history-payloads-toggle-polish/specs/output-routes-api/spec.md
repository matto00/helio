## ADDED Requirements

### Requirement: Output responses report history-payload limits
Every Output response that carries `historyPayloadsAvailable` (`GET/POST /api/pipelines/:id/outputs`,
`GET/PATCH /api/outputs/:id`, `GET /api/outputs`) SHALL also carry a read-only object `historyPayloadLimits` with
`maxRows` (integer), `maxBytes` (integer), and `tiers` holding `free`, `beta` and `owner`, each with `maxRuns`
(integer) and `maxAgeDays` (integer). The values SHALL be the payload-history limits the running server enforces,
including any environment overrides, and SHALL NOT be settable by a client.

#### Scenario: Default limits
- **WHEN** the server runs with no payload-history overrides and an Output is fetched
- **THEN** `historyPayloadLimits` is `{"maxRows":1000,"maxBytes":1048576,"tiers":{"free":{"maxRuns":0,"maxAgeDays":0},"beta":{"maxRuns":10,"maxAgeDays":7},"owner":{"maxRuns":30,"maxAgeDays":30}}}`

#### Scenario: Overridden limits
- **WHEN** the server's payload-history config sets max rows to 500 and beta retention to 5 runs / 3 days
- **THEN** every Output response's `historyPayloadLimits` reports `maxRows: 500` and beta `maxRuns: 5`, `maxAgeDays: 3`

#### Scenario: Client cannot set it
- **WHEN** a PATCH body's `config` includes `historyPayloadLimits`
- **THEN** the top-level response field still reflects the server's configured limits
