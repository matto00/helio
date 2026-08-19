## RENAMED Requirements

- FROM: `### Requirement: A bounded 6-tool conversational loop answers a goal`
- TO: `### Requirement: A bounded 7-tool conversational loop answers a goal`
- FROM: `### Requirement: The hop cap is 3, supplied by the caller`
- TO: `### Requirement: The hop cap is 4, supplied by the caller`

## MODIFIED Requirements

### Requirement: A bounded 7-tool conversational loop answers a goal
`AssistantService.converse(history, message, user)` SHALL run `ClaudeClient.sendWithTools` with the tool
set `[find, get_resource, test_connection, propose_dashboard, propose_pipeline, propose_combined,
propose_patch_set]` and `maxHops = 4`, returning an `AssistantTurnResult` carrying the final text and,
when a `propose_*` tool call validated successfully during the turn, the structured proposal object it
produced.

#### Scenario: A goal answerable from existing workspace data produces a DashboardProposal
- **WHEN** `converse` is called with a goal matching an existing DataType, and the scripted tool-use
  sequence resolves via `find` then a successful `propose_dashboard` call
- **THEN** the result's `proposal` is `Some(AssistantProposal.Dashboard(_))` carrying a
  `DashboardProposal` of the same quality `DashboardAuthoringService` would have produced

#### Scenario: A goal with no matching data falls back to propose_pipeline, with no special-case code
- **WHEN** `converse` is called with a goal for which `find` returns no matching DataType, and the
  scripted tool-use sequence resolves via a subsequent successful `propose_pipeline` (or
  `propose_combined`) call
- **THEN** the result's `proposal` reflects the pipeline (or combined) proposal — achieved purely
  through the system prompt and tool availability, with no `AssistantService` branching on whether
  `find` returned results

#### Scenario: A goal answerable without any proposal returns text only
- **WHEN** `converse` is called with a goal fully answerable via `find`/`get_resource` alone (e.g. a
  factual question), and Claude's final response contains no `propose_*` call
- **THEN** the result's `proposal` is `None` and `text` carries Claude's final answer

### Requirement: The hop cap is 4, supplied by the caller
`AssistantService` SHALL pass `maxHops = 4` to `ClaudeToolRequest`, never relying on any default
inside `ClaudeClient`.

#### Scenario: A 5th tool_use attempt terminates gracefully via the existing hop-budget outcome
- **WHEN** the scripted tool-use sequence would require a 5th round trip
- **THEN** `converse`'s result reflects `ClaudeToolOutcome.HopBudgetExhausted` gracefully (no
  exception), consistent with HEL-660's existing hard-cap behavior

## ADDED Requirements

### Requirement: An inline REST/SQL source must be connection-tested before its proposal finalizes
`AssistantToolExecutor` SHALL reject (as an `isError` tool_result, not raise an exception) a
`propose_pipeline` or `propose_combined` call whose pipeline `source` is an inline (non-`sourceId`)
`rest_api` or `sql` source, unless a `test_connection` call earlier in the same turn returned
`ok = true` for a config identical to that source's `config`. `sourceId`-referenced sources and
inline `csv`/`static` sources are exempt. A `test_connection` call SHALL dispatch to
`SourceService.testRest`/`testSql` (backed by `Connector.testConnection`/`ConnectionTest.run`) for
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
