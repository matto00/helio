## MODIFIED Requirements

### Requirement: Analyze projects a schema per node, including every tail
Analyze SHALL project a schema for every node in every lane across every root. A root-level node's input schema SHALL be its own root's source schema.

#### Scenario: Nodes in both roots' lanes are projected
- **WHEN** analyze is called on a pipeline with a lane under each of two roots
- **THEN** every node in both lanes carries a projected schema derived from its own root's source schema

#### Scenario: Analyze works at a node in a non-first lane
- **WHEN** analyze is requested for a node in the second of two sibling lanes
- **THEN** a schema is projected for that node
- **THEN** no structural-validation error is raised

#### Scenario: Rejoin schema is projected from both lanes
- **WHEN** analyze is requested for a `union` step whose parent lane projects columns `{a, b}` and whose `lane`-kind secondary input's referenced node projects `{a, c}`
- **THEN** the projected schema reflects both inputs per the configured mode, rather than the parent lane alone

#### Scenario: A source-kind secondary input falls back to best-effort projection
- **WHEN** analyze is requested for a `union` step whose `secondaryInput` is `source`-kind and the data source's schema cannot be resolved (empty `dataSourceId`, missing or invisible source, or no inferred schema)
- **THEN** the projected schema is the parent lane's schema unchanged, and no validation error is raised

#### Scenario: A resolved source-kind secondary input is projected
- **WHEN** analyze is requested for a `union` step whose `secondaryInput` is `source`-kind and the data source has an inferred schema `{a, c}` while the parent lane projects `{a, b}`
- **THEN** the projected schema is `{a, b, c}` (the parent lane's fields followed by the source-only fields), on the persisted analyze, node-capabilities, proposal-analyze and transactional-create paths alike

#### Scenario: A pipeline with one tail has two node projections
- **WHEN** `GET /api/pipelines/:id/analyze` is called on a pipeline with a trunk and one tail
  branching from it
- **THEN** the response includes a projected schema for the trunk's final step and a separate
  projected schema for the tail's final step

#### Scenario: Per-node projection reflects that node's own step chain only
- **WHEN** a tail applies a `select` step dropping a column present on the trunk
- **THEN** the tail's node projection excludes that column while the trunk's projection still
  includes it
