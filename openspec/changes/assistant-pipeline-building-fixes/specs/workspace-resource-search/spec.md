## ADDED Requirements

### Requirement: Token-based find matching
`find` SHALL match a resource when any significant query token (lower-cased, split on non-alphanumerics, ignoring
tokens shorter than 2 characters and a fixed stop list such as "my", "the", "dashboard") occurs in its name, and SHALL
rank results by the number of tokens matched; when no significant token remains it SHALL fall back to whole-query
substring matching.

#### Scenario: Multi-word query finds a single-word name
- **WHEN** the caller owns a dashboard named "Standings" and calls find("Fantasy Football standings dashboard")
- **THEN** the result includes that dashboard

### Requirement: Pipeline resource detail exposes nodes and Outputs
`get_resource` for a pipeline SHALL return its lane tree and an ordered `nodes` list with each step's id, parent step
id, root id, type, config (credential-bearing fields redacted), and output schema (column name and type from the
symbolic analyze), and SHALL list every Output of the pipeline with its id, name, kind, node step id and fieldMapping.

#### Scenario: Lookup-derived column is visible at its node
- **WHEN** a pipeline has a lookup step that adds `display_name` and get_resource is called for it
- **THEN** `laneTree` is non-empty, the lookup node's config is present, and its `outputSchema` contains `display_name`

### Requirement: Dashboard and Output resource detail link to their pipeline
`get_resource` for a dashboard SHALL list its panels with id, title, type, bound outputId and that Output's pipeline
id; `get_resource` for an Output SHALL include its pipelineId and nodeStepId.

#### Scenario: Dashboard to pipeline without name search
- **WHEN** a dashboard has a panel bound to an Output of pipeline P and get_resource is called for the dashboard
- **THEN** the panel entry carries the Output id and P's id
