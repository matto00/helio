## ADDED Requirements

### Requirement: Output-writing tools accept the insight kind

Every helio-mcp tool that takes an Output kind (`add_output`, `add_outputs_from_shape`, `create_pipeline`,
`propose_pipeline`, `analyze_pipeline_proposal`, `apply_pipeline_proposal`, `apply_combined_proposal`) SHALL accept `insight` alongside the
existing kinds, and every helio-mcp kind enum SHALL equal the kind enum of the backend's
`create-pipeline-transactional-output-request` schema. The config-writing tools SHALL document the insight config
keys (`preset`, `prompt`, `reads`, `refresh`, `maxSentences`, `maxChars`, `model`, empty `fieldMapping`, no
`compare`/`historyPayloads`), with the backend as the sole validator. On `add_output`/`update_output` the docs SHALL say `reads.outputs` names stored ids
of other non-insight Outputs of the same pipeline and that creating an insight does not render it immediately; on the
pipeline-creating and proposal tools they SHALL say any non-empty `reads.outputs` is rejected (a new pipeline has no
stored Output to read).

#### Scenario: Adding an insight Output
- **WHEN** an agent calls `add_output` with `kind: "insight"` on an existing pipeline node
- **THEN** the input passes schema validation and one `POST /api/pipelines/<id>/outputs` is issued with that kind

#### Scenario: Kind enum drift
- **WHEN** the backend schema's kind enum gains or loses a kind that a helio-mcp enum does not mirror
- **THEN** the drift test fails naming the enum

#### Scenario: place_outputs is kind-agnostic
- **WHEN** an agent places an insight Output with `place_outputs`
- **THEN** the panel batch request carries only that `outputId`, exactly as for any other kind

#### Scenario: Create-time reads rule is documented
- **WHEN** an agent reads the `create_pipeline` or `propose_pipeline` description
- **THEN** it states that a non-empty insight `reads.outputs` is rejected on a brand-new pipeline
