# markdown-panel Specification

## Purpose
TBD - created by archiving change markdown-panel-type. Update Purpose after archive.
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

### Requirement: Markdown panel renders CommonMark HTML in the dashboard grid

In the dashboard grid, a markdown panel SHALL render its resolved content as CommonMark-compliant HTML.
Resolved content is the bound DataType field's value when the panel is bound and data is available,
otherwise the literal `content` field. The rendered output SHALL be read-only (not directly editable in
the grid). Image references using the `helio://uploads/image/<id>` scheme SHALL render as the uploaded
asset (see the `markdown-panel-content-source` capability for the scheme's rules).

#### Scenario: Grid renders markdown content as HTML
- **WHEN** a markdown panel with non-empty content is displayed in the grid
- **THEN** the panel body shows rendered HTML (headings, paragraphs, lists) derived from the content

#### Scenario: Grid renders bound content when panel is bound
- **WHEN** a markdown panel bound to a DataType field with row data is displayed in the grid
- **THEN** the panel body renders the bound field's value as Markdown, taking priority over any stored
  literal content

#### Scenario: Grid renders empty markdown panel with placeholder
- **WHEN** a markdown panel has null or empty resolved content
- **THEN** the panel body shows a faded placeholder (e.g. "No content — edit to add Markdown")

#### Scenario: Grid renders an uploaded-image reference
- **WHEN** a markdown panel's content contains `![alt](helio://uploads/image/<id>)` for an existing
  upload
- **THEN** the panel body shows the uploaded image, served from `/api/uploads/image/<id>`

### Requirement: Markdown panel content is editable in the panel detail view

In the panel detail view edit mode, a markdown panel SHALL display a Content editor built on the
field-or-literal pattern (`useBoundOrLiteralState` + `DataTypePicker` + `BoundOrLiteralField` with a
multiline literal input), replacing the previous plain textarea. In Static mode the multiline literal
input SHALL contain the raw Markdown source; in Source mode a DataType picker and a field select SHALL
choose the bound field. Changes SHALL be saveable via the existing panel update flow
(`PATCH /api/panels/:id`).

#### Scenario: Static mode shows a multiline editor with raw Markdown source
- **WHEN** the panel detail view is opened for an unbound markdown panel in edit mode
- **THEN** the Content control defaults to Static mode with a multiline input containing the raw
  Markdown source string

#### Scenario: Source mode shows DataType picker and field select
- **WHEN** the user switches the markdown panel's Content control to Source mode
- **THEN** a DataType picker is shown, and selecting a DataType exposes a field select whose options are
  that type's fields (and computed fields)

#### Scenario: Saving Static content persists the new markdown source
- **WHEN** the user edits the Static-mode input and saves
- **THEN** `PATCH /api/panels/:id` is called with the new `content` value and the grid re-renders

#### Scenario: Bound markdown panel defaults to Source mode
- **WHEN** the panel detail view is opened for a markdown panel with `dataTypeId` set
- **THEN** the Content control defaults to Source mode with the bound DataType and field selected

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

