## ADDED Requirements

### Requirement: Every propose_* tool's guidance carries a concrete worked example
The four `propose_*` tools SHALL each carry at least one fully-formed worked example of a schema-valid call
(`propose_dashboard`, `propose_pipeline`, `propose_combined`, `propose_patch_set`): a top-level
JSON-Schema `examples` array in the tool's `inputSchema` containing at least one complete input object, and the
static system prompt SHALL include a compact shaping-guidance section covering the `propose_combined`
`"$pipelineOutput"` sentinel, the `propose_patch_set` `target`/`op`/`patch` shape, and pipeline source
existing-vs-inline branch exclusivity. Example resource ids SHALL be obviously-synthetic placeholders, and the
guidance SHALL state explicitly that real calls must only use ids returned by `find`/`get_resource` — the examples
must reinforce, never weaken, the existing never-fabricate-ids rule.

#### Scenario: Each propose_* input schema exposes a decodable worked example
- **WHEN** the `examples` array of each `propose_*` tool's `inputSchema` is read and each entry is decoded via the
  same spray-json conversion `AssistantToolExecutor` applies to a real call of that tool
- **THEN** every entry decodes successfully to the tool's proposal type (`DashboardProposal`, `PipelineProposal`,
  `CombinedProposal`, or `PatchSet`) with no `DeserializationException`

#### Scenario: The combined example exercises the pipeline-output sentinel
- **WHEN** `propose_combined`'s schema example is inspected and decoded
- **THEN** at least one dashboard panel in the example binds via the literal sentinel `"$pipelineOutput"` in place
  of a real dataTypeId, and the example still decodes to a `CombinedProposal`

#### Scenario: The system prompt's shaping guidance is present and placeholder-safe
- **WHEN** `AssistantSystemPrompt.text` is inspected
- **THEN** it contains a worked-example/shaping section that shows well-formed `propose_*` call structure and an
  explicit statement that example ids are placeholders and real ids must come from `find`/`get_resource` results
