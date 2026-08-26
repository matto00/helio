## MODIFIED Requirements

### Requirement: An inline REST/SQL source must be connection-tested before its proposal finalizes
`AssistantToolExecutor` SHALL reject (as an `isError` tool_result, not raise an exception) a
`propose_pipeline` or `propose_combined` call whose pipeline `source` is an inline (non-`sourceId`)
`rest_api` or `sql` source, unless a `test_connection` call earlier in the same turn returned
`ok = true` for a config identical to that source's `config`. `sourceId`-referenced sources and
inline `csv`/`static` sources are exempt. A `test_connection` call SHALL dispatch to
`SourceService.testRest`/`testSql` (backed by `ConnectorDriver.testConnection`/`ConnectionTest.run`) for
the discriminated `type`/`config` payload it is given, and only a successful (`ok = true`) result
marks that exact config as verified for the remainder of the turn.

#### Scenario: An untested inline REST source is rejected, not finalized
- **WHEN** `propose_pipeline` is called with an inline `rest_api` source whose config was never
  passed to a successful `test_connection` call earlier in the same turn
- **THEN** the call resolves to an `isError` tool_result asking for `test_connection` first, and no
  `AssistantProposal` is captured

#### Scenario: A verified inline REST source proceeds to validation normally
- **WHEN** `test_connection` is called with an inline REST config and returns `ok = true`, and a
  subsequent `propose_pipeline` call in the same turn carries an inline source with the identical
  config
- **THEN** `propose_pipeline` proceeds to `PipelineProposalService.validate` exactly as before this
  change, unaffected by the new gate

#### Scenario: A failed test_connection does not verify the config
- **WHEN** `test_connection` is called with a config that resolves to `ok = false` (e.g. DNS
  failure), and a subsequent `propose_pipeline` call in the same turn carries an inline source with
  that same config
- **THEN** `propose_pipeline` is still rejected as unverified — a failed test never marks the config
  verified

#### Scenario: An edited config after verification is treated as unverified
- **WHEN** `test_connection` verifies a config, and a subsequent `propose_pipeline` call in the same
  turn carries an inline source whose config differs from the verified one in any field
- **THEN** `propose_pipeline` is rejected as unverified — verification is by exact config equality,
  never a fuzzy/partial match

#### Scenario: propose_combined applies the identical gate to its nested pipeline source
- **WHEN** `propose_combined` is called with an inline `rest_api`/`sql` `pipeline.source` whose
  config was never verified earlier in the same turn
- **THEN** the call resolves to an `isError` tool_result asking for `test_connection` first, and no
  `AssistantProposal` is captured

#### Scenario: sourceId and inline csv/static sources are exempt from the gate
- **WHEN** `propose_pipeline` is called with a `sourceId`-referenced source, or an inline `csv` or
  `static` source
- **THEN** the call proceeds to `PipelineProposalService.validate` without requiring any
  `test_connection` call
