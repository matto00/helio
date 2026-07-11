## ADDED Requirements

### Requirement: Markdown/text panel can be created with initial content via a dashboard proposal
`POST /api/dashboards/apply-proposal` SHALL accept an optional `content` field per text/markdown
panel in the proposal. When present, the created panel's `config.content` SHALL be set to that value
at creation time, so the panel renders the proposed content immediately without a follow-up manual
edit. When absent, the panel SHALL be created with empty content (today's behavior).

#### Scenario: Proposal-created markdown panel renders its proposed content
- **WHEN** a dashboard proposal's panel has `type: "markdown"` and `content: "# Roadmap\n- Q1: ..."`
- **THEN** the applied panel's `config.content` is `"# Roadmap\n- Q1: ..."` and the dashboard grid
  renders that Markdown as HTML

#### Scenario: Proposal chart/markdown panel with no content creates an empty panel
- **WHEN** a dashboard proposal's `markdown` panel specifies no `content` field
- **THEN** the applied panel's `config.content` is empty (today's placeholder-rendering behavior)
