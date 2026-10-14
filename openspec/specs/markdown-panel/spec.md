# markdown-panel Specification

## Purpose
Defines how a literal markdown panel stores and updates its CommonMark `config.content` and renders it as read-only
HTML in the dashboard grid; markdown content is never resolved from a data field.

## Requirements

### Requirement: Markdown panel stores CommonMark source as content
A panel with `type: "markdown"` SHALL store its content as a raw CommonMark text string in its typed config's
`config.content` field; there is no top-level `content` field on a panel request or response. `config.content` SHALL be
persisted to the database and returned in every authenticated panel response for that panel.

#### Scenario: Markdown panel created with content
- **WHEN** `POST /api/panels` is called with `type: "markdown"` and `config: { content: "# Hello\nWorld" }`
- **THEN** the response includes `type: "markdown"` and `config.content: "# Hello\nWorld"`, and no top-level `content`

#### Scenario: Markdown panel content survives round-trip
- **WHEN** a markdown panel's dashboard is read back through `GET /api/dashboards/:id/export`
- **THEN** that panel's `config.content` is the original stored Markdown source

### Requirement: Markdown panel content is updatable via PATCH
The `PATCH /api/panels/:id` endpoint SHALL accept `config.content` for a markdown panel and update the stored content
when it is provided as a string. An absent `config.content` SHALL leave the stored content unchanged; an explicit
`null` SHALL clear it to the empty string `""`. The stored content is never null.

#### Scenario: PATCH updates markdown content
- **WHEN** a PATCH request to a markdown panel includes `config: { content: "## Updated" }`
- **THEN** the response includes `config.content: "## Updated"`

#### Scenario: PATCH without content leaves content unchanged
- **WHEN** a PATCH request to a markdown panel does not include `config.content`
- **THEN** the panel's existing `config.content` is preserved in the response

#### Scenario: PATCH with null content clears it to the empty string
- **WHEN** a PATCH request to a markdown panel with stored content includes `config: { content: null }`
- **THEN** the response includes `config.content: ""`

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

### Requirement: Only text and markdown panels carry literal content
Only `text` and `markdown` panels carry literal content, each in its own `config.content`. A panel of any other current
type (`output`, `image`, `divider`, `form`) SHALL have no `content` key in its `config` in API responses. A `content`
key sent in such a panel's `config` on create or update SHALL never become stored content: depending on that type's
config decoder it is either dropped or the request is rejected with `400` (a `form` panel's config is a closed
attribute set, so a create carrying `content` is rejected).

#### Scenario: Non-content panel returns no content
- **WHEN** a panel whose type is not `text` or `markdown` is retrieved
- **THEN** its `config` has no `content` key

#### Scenario: Content sent for an image panel is dropped
- **WHEN** an `image` panel is created with `config: { imageUrl: "...", content: "x" }`
- **THEN** the panel is created and its `config` has no `content` key

#### Scenario: Content sent on a form panel create is rejected
- **WHEN** a `form` panel is created with a `config` that carries a `content` key
- **THEN** the request is rejected with `400` naming the unrecognized attribute, and no panel is created

#### Scenario: Text panel keeps its own literal content
- **WHEN** a `text` panel is created with `config: { content: "Hello" }`
- **THEN** the response includes `config.content: "Hello"`
