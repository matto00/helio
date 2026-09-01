## ADDED Requirements

### Requirement: usePipelineRunEvents surfaces per-node progress without disturbing run-level state

`usePipelineRunEvents` SHALL recognize a `node-progress` SSE event (carrying `nodeId` and a per-node
`rowCount`) as distinct from the run-level `status`/`rowCount` fields it already exposes. A
`node-progress` event SHALL NOT change the hook's `status` or `rowCount` fields, and SHALL NOT be
treated as a terminal event (the connection stays open). The hook SHALL expose the most recently
received `node-progress` event's `nodeId` and row count via new fields (e.g. `nodeId`,
`nodeRowCount`), independent of the existing `status`/`rowCount`/`errorLog` fields.

#### Scenario: A node-progress event updates only the new per-node fields

- **WHEN** the SSE stream emits `{ status: "node-progress", nodeId: "step-123", rowCount: 42 }`
  while the hook's `status` currently holds `"running"`
- **THEN** the hook's `status` remains `"running"` and its run-level `rowCount` is unchanged
- **AND** the hook's `nodeId` becomes `"step-123"` and its `nodeRowCount` becomes `42`

#### Scenario: A node-progress event does not close the connection

- **WHEN** the SSE stream emits a `node-progress` event
- **THEN** the `EventSource` remains open and continues to receive further events
