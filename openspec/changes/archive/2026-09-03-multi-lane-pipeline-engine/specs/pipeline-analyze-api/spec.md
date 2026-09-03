## MODIFIED Requirements

### Requirement: Analyze projects a schema per node, including every tail
The analyze surface SHALL project a schema for any node in the pipeline graph, regardless of which lane it belongs to or how many siblings its parent has. For a `join`, `union` or `lookup` step whose `secondaryInput` is **`lane`-kind**, the projected schema SHALL be derived from **both** of its inputs — the parent lane's projected schema and the referenced node's projected schema.

For a **`source`-kind** secondary input the secondary schema SHALL NOT be resolved at the analyze layer, and the step SHALL fall back to its documented best-effort projection (`union`: identity passthrough; `join`: the parent lane's schema unchanged; `lookup`: the requested `columns` appended with best-effort typing).

**Why this asymmetry, stated plainly for a future reader.** An earlier draft of this requirement — written at this change's own design gate — promised both-input derivation "whether that secondary input is a data source or a referenced lane node." That clause described behaviour which did not exist and **could not** exist without an architectural change: `PipelineAnalyzeService.analyzeNodes` is a pure, synchronous domain function with no repository access, and resolving a `source`-kind input requires an async `DataSourceRepository` lookup. A `lane`-kind input is resolvable precisely because the referenced node is already present in the step set handed to the function. The clause was an **overreach in the spec, not a shortfall in the implementation** — source-kind derivation never existed at any point before this change either. It is corrected here to state what actually ships, and the remainder is tracked as HEL-965 (Medium). This is a correction of a false statement, not a decision to descope working behaviour.

#### Scenario: Analyze works at a node in a non-first lane
- **WHEN** analyze is requested for a node in the second of two sibling lanes
- **THEN** a schema is projected for that node
- **THEN** no structural-validation error is raised

#### Scenario: Rejoin schema is projected from both lanes
- **WHEN** analyze is requested for a `union` step whose parent lane projects columns `{a, b}` and whose `lane`-kind secondary input's referenced node projects `{a, c}`
- **THEN** the projected schema reflects both inputs per the configured mode, rather than the parent lane alone

#### Scenario: A source-kind secondary input falls back to best-effort projection
- **WHEN** analyze is requested for a `union` step whose `secondaryInput` is `source`-kind
- **THEN** the projected schema is the parent lane's schema unchanged, and no validation error is raised
- **THEN** the secondary data source's schema is not resolved — see HEL-965

#### Scenario: A pipeline with one tail has two node projections
- **WHEN** `GET /api/pipelines/:id/analyze` is called on a pipeline with a trunk and one tail
  branching from it
- **THEN** the response includes a projected schema for the trunk's final step and a separate
  projected schema for the tail's final step

#### Scenario: Per-node projection reflects that node's own step chain only
- **WHEN** a tail applies a `select` step dropping a column present on the trunk
- **THEN** the tail's node projection excludes that column while the trunk's projection still
  includes it
