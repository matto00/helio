## ADDED Requirements

### Requirement: Image panel can be created with an initial URL via a dashboard proposal
`POST /api/dashboards/apply-proposal` SHALL accept an optional `url` field per image panel in the
proposal. When present, the created panel's `config.imageUrl` SHALL be set to that value (with
`imageFit` defaulting to `"contain"`) at creation time. When absent, the panel SHALL be created with
no image (today's placeholder-rendering behavior).

#### Scenario: Proposal-created image panel renders its proposed image
- **WHEN** a dashboard proposal's panel has `type: "image"` and `url: "https://example.com/logo.png"`
- **THEN** the applied panel's `config.imageUrl` is `"https://example.com/logo.png"` and the dashboard
  grid renders that image with `object-fit: contain`

#### Scenario: Proposal image panel with no url creates a placeholder panel
- **WHEN** a dashboard proposal's `image` panel specifies no `url` field
- **THEN** the applied panel's `config.imageUrl` is empty (today's placeholder-rendering behavior)
