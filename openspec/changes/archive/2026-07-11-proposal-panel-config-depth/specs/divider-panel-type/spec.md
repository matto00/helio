## ADDED Requirements

### Requirement: Divider panel can be created with an initial orientation via a dashboard proposal
`POST /api/dashboards/apply-proposal` SHALL accept an optional `orientation` field
(`"horizontal"`|`"vertical"`) per divider panel in the proposal. When present, the created panel's
`config.orientation` SHALL be set to that value at creation time. When absent, the panel SHALL be
created with the default `"horizontal"` orientation (today's behavior).

#### Scenario: Proposal-created divider panel renders its proposed orientation
- **WHEN** a dashboard proposal's panel has `type: "divider"` and `orientation: "vertical"`
- **THEN** the applied panel's `config.orientation` is `"vertical"` and the dashboard grid renders a
  vertical rule

#### Scenario: Proposal divider panel with no orientation defaults to horizontal
- **WHEN** a dashboard proposal's `divider` panel specifies no `orientation` field
- **THEN** the applied panel's `config.orientation` is `"horizontal"` (today's default)

#### Scenario: An invalid orientation is rejected before anything is created
- **WHEN** `POST /api/dashboards/apply-proposal` is called with a divider panel's `orientation` set to
  a value other than `horizontal`/`vertical`
- **THEN** the response is 400 and no dashboard or panel is created
