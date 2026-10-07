## ADDED Requirements

### Requirement: update_output documents the history-payloads opt-in
The helio-mcp `update_output` tool description SHALL document `config.historyPayloads`: it is a boolean opt-in to keep
each real run's full rows; a run over 1,000 rows or 1 MiB keeps only its summary; rows are kept only when the
pipeline owner's tier allows it (free keeps none), and the Output's `historyPayloadsAvailable` field reports that; and
turning it off stops storing rows while stored rows expire on the normal schedule. Sending
`config: {"historyPayloads": true}` through `update_output` SHALL reach `PATCH /api/outputs/:id` unchanged.

#### Scenario: Agent enables payloads
- **WHEN** an agent calls `update_output` with `config: {"historyPayloads": true}`
- **THEN** the PATCH body sent to `/api/outputs/:id` carries `config.historyPayloads === true`, and the updated Output is
  returned

#### Scenario: Description is discoverable
- **WHEN** a client lists tools
- **THEN** `update_output`'s description mentions `historyPayloads`, the 1,000-row / 1 MiB caps, and
  `historyPayloadsAvailable`
