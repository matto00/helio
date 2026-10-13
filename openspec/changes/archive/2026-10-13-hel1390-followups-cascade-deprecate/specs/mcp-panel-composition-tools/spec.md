## ADDED Requirements

### Requirement: Inert panel-level proposal fields are marked deprecated

The proposal panel fields `fieldMapping`, `aggregation`, `label` and `unit` have no effect on an applied panel (that
configuration lives on the Output). Every agent-facing description of the proposal panel shape — the dashboard
proposal JSON schema, the in-app assistant's proposal tool schema, and the MCP proposal tools' panel schema — SHALL
mark each of these four fields as deprecated and state that it is ignored and that the setting belongs on the
Output's `config`. The fields SHALL remain accepted: a proposal carrying them SHALL NOT be rejected for it, and SHALL
produce the same panels as the same proposal without them.

#### Scenario: Each agent-facing surface marks the four fields deprecated
- **WHEN** the proposal panel shape is read from the dashboard proposal JSON schema, the assistant proposal tool
  schema and the MCP proposal panel schema
- **THEN** on each surface `fieldMapping`, `aggregation`, `label` and `unit` are marked deprecated with a description
  saying they are ignored and belong on the Output config

#### Scenario: A proposal carrying the deprecated fields is still accepted and they stay inert
- **WHEN** a proposal whose output panel carries `fieldMapping`, `aggregation`, `label` and `unit` is applied
- **THEN** it is accepted and the created panel's config equals that of the same proposal without those fields
