## ADDED Requirements

### Requirement: Grantees can ask about a shared dashboard

A grantee's shell SHALL offer "Ask about this dashboard" on a dashboard shared with them, for both `viewer` and
`editor` roles; Ask is not an owner-only action. Pinning an answer SHALL remain governed by the server's `pin` field.

#### Scenario: Viewer sees the Ask entry

- **WHEN** a viewer grantee opens a shared dashboard
- **THEN** the "Ask about this dashboard" entry is offered, while share, delete, duplicate and editing controls remain
  absent
