## ADDED Requirements

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
In the dashboard grid, a markdown panel SHALL render its `content` field as CommonMark-compliant HTML.
The rendered output SHALL be read-only (not directly editable in the grid).

#### Scenario: Grid renders markdown content as HTML
- **WHEN** a markdown panel with non-empty content is displayed in the grid
- **THEN** the panel body shows rendered HTML (headings, paragraphs, lists) derived from the content

#### Scenario: Grid renders empty markdown panel with placeholder
- **WHEN** a markdown panel has null or empty content
- **THEN** the panel body shows a faded placeholder (e.g. "No content — edit to add Markdown")

### Requirement: Markdown panel content is editable in the panel detail view
In the panel detail view edit mode, a markdown panel SHALL display a plain `<textarea>` containing
the raw Markdown source. Changes made in the textarea SHALL be saveable via the existing panel
update flow.

#### Scenario: Edit mode shows textarea with raw Markdown source
- **WHEN** the panel detail view is opened for a markdown panel in edit mode
- **THEN** a textarea is displayed containing the raw Markdown source string

#### Scenario: Saving edit mode content persists the new markdown source
- **WHEN** the user edits the textarea and saves
- **THEN** `PATCH /api/panels/:id` is called with the new `content` value and the grid re-renders

### Requirement: Non-markdown panels have null content
Panels of type `metric`, `chart`, `text`, or `table` SHALL have `content: null` in all API responses.
The `content` field SHALL be ignored (not stored) if sent for a non-markdown panel on create or update.

#### Scenario: Non-markdown panel returns null content
- **WHEN** any panel with type other than `markdown` is retrieved
- **THEN** the response includes `content: null`
