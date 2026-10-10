# markdown-panel Specification

## Purpose
Defines how a literal markdown panel stores and updates its CommonMark `config.content` and renders it as read-only
HTML in the dashboard grid; markdown content is never resolved from a data field.

## Requirements

### Requirement: Markdown panel stores CommonMark source as content
A panel with `type: "markdown"` SHALL store its content as a raw CommonMark text string in the
`content` field. The content field SHALL be persisted to the database and returned in all panel
API responses for that panel.

#### Scenario: Markdown panel created with content
- **WHEN** `POST /api/panels` is called with `type: "markdown"` and `content: "# Hello\nWorld"`
- **THEN** the response includes `type: "markdown"` and `content: "# Hello\nWorld"`

#### Scenario: Markdown panel content survives round-trip
- **WHEN** a markdown panel is retrieved via `GET /api/dashboards/:id/panels`
- **THEN** the response includes `content` with the original stored Markdown source

### Requirement: Markdown panel content is updatable via PATCH
The `PATCH /api/panels/:id` endpoint SHALL accept a `content` field for markdown panels and update
the stored content when provided.

#### Scenario: PATCH updates markdown content
- **WHEN** a PATCH request to a markdown panel includes `content: "## Updated"`
- **THEN** the response includes `content: "## Updated"`

#### Scenario: PATCH without content leaves content unchanged
- **WHEN** a PATCH request to a markdown panel does not include a `content` field
- **THEN** the panel's existing content is preserved in the response

### Requirement: Non-markdown panels have null content
Panels of type `metric`, `chart`, `text`, or `table` SHALL have `content: null` in all API responses.
The `content` field SHALL be ignored (not stored) if sent for a non-markdown panel on create or update.

#### Scenario: Non-markdown panel returns null content
- **WHEN** any panel with type other than `markdown` is retrieved
- **THEN** the response includes `content: null`

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

### Requirement: Markdown panel renders its literal content as CommonMark HTML in the dashboard grid

In the dashboard grid, a markdown panel SHALL render its literal content as CommonMark-compliant HTML. The literal
content is the panel's own `config.content` for a markdown panel, or the placed Output's `config.content` for a
panel that places a `markdown`-kind Output. Markdown content SHALL NOT be resolved from a data field or row: neither
a markdown panel nor a markdown Output has a data binding, and a `fieldMapping` stored on a markdown Output SHALL NOT
change what is rendered. The rendered output SHALL be read-only (not directly editable in the grid). Image references
using the `helio://uploads/image/<id>` scheme SHALL render as the uploaded asset (see the
`markdown-panel-content-source` capability for the scheme's rules).

#### Scenario: Grid renders markdown content as HTML
- **WHEN** a markdown panel with non-empty content is displayed in the grid
- **THEN** the panel body shows rendered HTML (headings, paragraphs, lists) derived from the content

#### Scenario: Placed markdown Output renders its literal content
- **WHEN** a panel placing a `markdown`-kind Output is displayed in the grid
- **THEN** the panel body renders that Output's `config.content` as Markdown, and a `fieldMapping` stored on that
  Output does not change what is rendered

#### Scenario: Grid renders empty markdown panel with placeholder
- **WHEN** a markdown panel has null or empty content
- **THEN** the panel body shows a faded placeholder ("No content yet. Open panel settings to add markdown.")

#### Scenario: Grid renders an uploaded-image reference
- **WHEN** a markdown panel's content contains `![alt](helio://uploads/image/<id>)` for an existing
  upload
- **THEN** the panel body shows the uploaded image, served from `/api/uploads/image/<id>`
