## ADDED Requirements

### Requirement: Image panel supports an optional static caption

Image panel config SHALL accept an optional `caption` string. When `caption` is a non-blank string, the
image panel SHALL render a caption strip beneath the image showing that text. When `caption` is absent,
null, empty, or whitespace-only, no caption strip SHALL be rendered (the panel appears exactly as today).
The caption text SHALL scale with the panel and wrap or truncate gracefully (clamped with an ellipsis)
rather than overflowing the panel body or displacing the image.

#### Scenario: Image panel with a caption renders a caption strip
- **WHEN** an image panel with a non-null `imageUrl` has `config.caption: "Hero photo — Reuters"`
- **THEN** the panel body shows the image and, beneath it, a caption strip containing "Hero photo — Reuters"

#### Scenario: Image panel without a caption renders no strip
- **WHEN** an image panel has no `caption` (absent, null, empty, or whitespace-only)
- **THEN** the panel body shows only the image with no caption strip

#### Scenario: A placeholder image panel with a caption still shows the caption
- **WHEN** an image panel has a null `imageUrl` but a non-blank `caption`
- **THEN** the caption strip is rendered beneath the placeholder

#### Scenario: A long caption truncates rather than overflowing
- **WHEN** an image panel's `caption` is longer than the panel width
- **THEN** the caption is clamped (wrapped and ellipsis-truncated) within the panel body and does not
  overflow or push the image out of view

### Requirement: Image panel caption round-trips through the panel API

The `PATCH /api/panels/:id` endpoint SHALL accept an optional `caption` field (string or null) on image
panels and persist it. Absent `caption` SHALL leave the stored value unchanged; a `null`, empty, or
whitespace-only `caption` SHALL clear it (stored as SQL `NULL`). An image panel response's `config`
SHALL include `caption` when a caption is set and SHALL omit `caption` when it is unset, following the
in-repo spray-json `None`-omission convention (fields are absent, not `null`; see
`collection-panel-type`). Because the panel response carries a per-subtype nested `config`, panels of
other types carry no `caption` field at all. The caption SHALL be carried through panel duplication and
dashboard export/import.

#### Scenario: PATCH sets a caption on an image panel
- **WHEN** a PATCH request is sent with `caption: "Source: NASA"` on an image panel
- **THEN** the response `config` includes `caption: "Source: NASA"`

#### Scenario: PATCH without a caption leaves it unchanged
- **WHEN** a PATCH request omits the `caption` field on an image panel with an existing caption
- **THEN** the panel's existing `caption` is preserved in the response `config`

#### Scenario: PATCH with null caption clears it
- **WHEN** a PATCH request is sent with `caption: null` on an image panel that had a caption
- **THEN** the response `config` omits `caption`

#### Scenario: A non-image panel config carries no caption field
- **WHEN** a panel whose type is not `image` is retrieved
- **THEN** its `config` contains no `caption` field

#### Scenario: Duplicating an image panel copies its caption
- **WHEN** an image panel with `caption: "Fig. 1"` is duplicated
- **THEN** the duplicate's `caption` is `"Fig. 1"`

### Requirement: Image panel config editor exposes the caption field

The Image panel's config editor SHALL offer a text control for the `caption`, alongside the existing URL
and fit controls. Editing and saving the caption SHALL persist it via `PATCH /api/panels/:id`; clearing
the control SHALL clear the stored caption.

#### Scenario: Editing the caption in the config editor persists it
- **WHEN** a user types "Q3 revenue chart" into the Image panel config's caption control and saves
- **THEN** `PATCH /api/panels/:id` is called with that caption and the panel re-renders showing the
  caption strip

#### Scenario: Clearing the caption control clears the stored caption
- **WHEN** a user empties the caption control on an image panel that had a caption and saves
- **THEN** `PATCH /api/panels/:id` clears the caption and the panel re-renders with no caption strip
