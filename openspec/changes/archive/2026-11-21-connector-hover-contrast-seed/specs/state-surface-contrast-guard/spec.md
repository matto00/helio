## ADDED Requirements

### Requirement: The guard seeds a connector wherever it measures /connectors

Every guard cell that measures the `/connectors` route, at every width the guard covers (1440, 1100, 768 and 390 px) and in both themes, SHALL seed at least one connector for its user before probing, and SHALL wait until that connector's row has rendered, so the connector row and its row actions are part of the measured population. Seeding SHALL make no request to any external host.

#### Scenario: A seeded connector's controls are sampled

- **WHEN** the guard measures `/connectors` at any covered width in either theme
- **THEN** the connector's table row and its actions-menu trigger are among the sampled controls, and at widths where the standalone "Test connection" button is mounted it is sampled too

#### Scenario: Seeding stays offline

- **WHEN** the guard seeds the connector
- **THEN** the connector uses no credential and a base URL that never resolves, and no connection test or fetch is issued
