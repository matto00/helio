## MODIFIED Requirements

### Requirement: Every propose_* tool's guidance carries a concrete worked example
The four `propose_*` tools SHALL each carry at least one fully-formed worked example of a schema-valid call
(`propose_dashboard`, `propose_pipeline`, `propose_combined`, `propose_patch_set`): a top-level
JSON-Schema `examples` array in the tool's `inputSchema` containing at least one complete input object, and the
static system prompt SHALL include a compact shaping-guidance section covering the `propose_combined`
`"$pipelineOutput"` sentinel, the `propose_patch_set` `target`/`op`/`patch` shape **including `target.parentId`
for a create edit**, and the pipeline **roots** existing-vs-inline branch exclusivity **per root**. Example
resource ids SHALL be obviously-synthetic placeholders, and the guidance SHALL state explicitly that real calls
must only use ids returned by `find`/`get_resource` — the examples must reinforce, never weaken, the existing
never-fabricate-ids rule.

Every worked example and every line of shaping guidance SHALL describe the shape the backend actually accepts.
An example or instruction teaching a singular `source` is a defect of this requirement, not merely stale prose:
the proposal reader rejects `source` outright, so an agent following its own guidance would author a call the
backend refuses. This is the one consumer with no compile-time or test-time coupling to the wire shape, so the
requirement is stated in terms of the rendered text rather than in terms of a passing test.

#### Scenario: Each propose_* input schema exposes a decodable worked example
- **WHEN** the `examples` array of each `propose_*` tool's `inputSchema` is read and each entry is decoded via the
  same spray-json conversion `AssistantToolExecutor` applies to a real call of that tool
- **THEN** every entry decodes successfully to the tool's proposal type (`DashboardProposal`, `PipelineProposal`,
  `CombinedProposal`, or `PatchSet`) with no `DeserializationException`

#### Scenario: The pipeline and combined examples carry roots, not a singular source
- **WHEN** `propose_pipeline`'s and `propose_combined`'s schema examples are read
- **THEN** each carries a non-empty `roots` array and no `source` key, and each still decodes to its
  proposal type — the decode alone is not sufficient evidence, because a stale example that failed to
  decode and a stale example that decoded would both be defects

#### Scenario: The combined example exercises the pipeline-output sentinel
- **WHEN** `propose_combined`'s schema example is inspected and decoded
- **THEN** at least one dashboard panel in the example binds via the literal sentinel `"$pipelineOutput"` in place
  of a real outputId, and the example still decodes to a `CombinedProposal`

#### Scenario: The system prompt's shaping guidance is present and placeholder-safe
- **WHEN** `AssistantSystemPrompt.text` is inspected
- **THEN** it contains a worked-example/shaping section that shows well-formed `propose_*` call structure and an
  explicit statement that example ids are placeholders and real ids must come from `find`/`get_resource` results

#### Scenario: The system prompt describes roots, per-root branch exclusivity, and parentId
- **WHEN** `AssistantSystemPrompt.text` is rendered and read
- **THEN** its pipeline guidance describes a `roots` array whose branch exclusivity is stated per root, its
  `test_connection` guidance requires a successful test for every inline `rest_api`/`sql` root rather than for
  "the source", and its `propose_patch_set` guidance describes `target.parentId` alongside `target.kind`/`id`

#### Scenario: The rendered prompt names no singular source shape
- **WHEN** `AssistantSystemPrompt.text` is rendered and searched
- **THEN** it contains no instruction describing a proposal's source as a single object


### Requirement: An inline REST/SQL source must be connection-tested before its proposal finalizes
`AssistantToolExecutor` SHALL reject (as an `isError` tool_result, not raise an exception) a
`propose_pipeline` or `propose_combined` call carrying **any** inline (non-`sourceId`) `rest_api` or
`sql` root, unless a `test_connection` call earlier in the same turn returned `ok = true` for a
config identical to that root's `config`. Every inline root SHALL be checked independently — a
verified first root does not exempt an unverified second. `sourceId`-referenced roots and inline
`csv`/`static` roots are exempt. A `test_connection` call SHALL dispatch to
`SourceService.testRest`/`testSql` (backed by `ConnectorDriver.testConnection`/`ConnectionTest.run`) for
the discriminated `type`/`config` payload it is given, and only a successful (`ok = true`) result
marks that exact config as verified for the remainder of the turn.

#### Scenario: An untested inline REST source is rejected, not finalized
- **WHEN** `propose_pipeline` is called with an inline `rest_api` root whose config was never
  passed to a successful `test_connection` call earlier in the same turn
- **THEN** the tool result is an `isError` result naming the untested root, and no proposal is finalized

#### Scenario: An untested second inline root is rejected even when the first was verified
- **WHEN** `propose_pipeline` is called with two inline `rest_api` roots, only the first of which was
  connection-tested successfully earlier in the same turn
- **THEN** the tool result is an `isError` result naming the second root, and no proposal is finalized

#### Scenario: Every inline root tested successfully finalizes the proposal
- **WHEN** `propose_pipeline` is called with two inline `sql` roots, each of whose configs returned
  `ok = true` from a `test_connection` call earlier in the same turn
- **THEN** the proposal is finalized

#### Scenario: A verified inline REST source proceeds to validation normally
- **WHEN** `test_connection` is called with an inline REST config and returns `ok = true`, and a
  subsequent `propose_pipeline` call in the same turn carries a root with the identical config
- **THEN** `propose_pipeline` proceeds to `PipelineProposalService.validate` exactly as before this
  change, unaffected by the new gate

#### Scenario: A failed test_connection does not verify the config
- **WHEN** `test_connection` is called with a config that resolves to `ok = false` (e.g. DNS
  failure), and a subsequent `propose_pipeline` call in the same turn carries a root with that same
  config
- **THEN** `propose_pipeline` is still rejected as unverified — a failed test never marks the config
  verified

#### Scenario: An edited config after verification is treated as unverified
- **WHEN** `test_connection` verifies a config, and a subsequent `propose_pipeline` call in the same
  turn carries a root whose config differs from the verified one in any field
- **THEN** `propose_pipeline` is rejected as unverified — verification is by exact config equality,
  never a fuzzy/partial match

#### Scenario: propose_combined applies the identical gate to its nested pipeline source
- **WHEN** `propose_combined` is called with an inline `rest_api`/`sql` root in `pipeline.roots`
  whose config was never verified earlier in the same turn
- **THEN** the call resolves to an `isError` tool_result asking for `test_connection` first, and no
  `AssistantProposal` is captured

#### Scenario: sourceId and inline csv/static sources are exempt from the gate
- **WHEN** `propose_pipeline` is called with a `sourceId`-referenced root, or an inline `csv` or
  `static` root
- **THEN** the call proceeds to `PipelineProposalService.validate` without requiring any
  `test_connection` call
