## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Non-markdown panels have null content
**Reason**: Lists `text` (which carries its own `config.content`) and the deleted `metric`/`chart`/`table` kinds, and describes a top-level `content: null` that no panel response has.
**Migration**: Replaced by "Only text and markdown panels carry literal content".

## ADDED Requirements

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
