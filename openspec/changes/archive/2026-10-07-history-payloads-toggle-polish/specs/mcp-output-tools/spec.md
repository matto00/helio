## MODIFIED Requirements

### Requirement: update_output documents the history-payloads opt-in
The helio-mcp `update_output` tool description SHALL document `config.historyPayloads`: it is a boolean opt-in to keep
each real run's full rows; a run over the row or byte cap keeps only its summary; rows are kept only when the pipeline
owner's tier allows it (free keeps none by default), and the Output's `historyPayloadsAvailable` field reports that;
the exact caps and per-tier retention are reported by the Output's read-only `historyPayloadLimits` field rather than
fixed in the description; and turning it off stops storing rows while stored rows expire on the normal schedule.
Sending `config: {"historyPayloads": true}` through `update_output` SHALL reach `PATCH /api/outputs/:id` unchanged.

#### Scenario: Agent enables payloads
- **WHEN** an agent calls `update_output` with `config: {"historyPayloads": true}`
- **THEN** the PATCH body sent to `/api/outputs/:id` carries `config.historyPayloads === true`, and the updated Output is
  returned

#### Scenario: Description is discoverable
- **WHEN** a client lists tools
- **THEN** `update_output`'s description mentions `historyPayloads`, `historyPayloadsAvailable` and
  `historyPayloadLimits`, and does not state the 1,000-row / 1 MiB figures as fixed values
