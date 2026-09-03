## MODIFIED Requirements

### Requirement: Run-status events carry per-node identity and row counts
The run SSE stream SHALL emit a row count for every evaluated node in the graph, keyed by node id, including nodes in every lane and rejoin steps. A disabled node SHALL continue to receive no row-count entry, unchanged. A failure event SHALL carry the failing node's lane path in the format specified by `pipeline-run-execution`.

#### Scenario: Counts are emitted for nodes in both lanes
- **WHEN** a pipeline with two sibling lanes is run
- **THEN** the stream carries a row count for every evaluated node in both lanes

#### Scenario: A disabled node in a lane gets no count entry
- **WHEN** a lane contains a disabled node
- **THEN** no row-count entry is emitted for it and its incoming frame passes through unchanged

#### Scenario: A tail node's progress is reported by node id

- **GIVEN** a pipeline with a tail attached to a mid-trunk node
- **WHEN** the pipeline runs and the tail is evaluated
- **THEN** a `node-progress` SSE event is emitted carrying the tail node's `nodeId` and its row count
