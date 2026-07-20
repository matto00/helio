# image-panel-type Specification

## Purpose
TBD - created by archiving change image-panel-type. Update Purpose after archive.
## Requirements
### Requirement: Image panel renders a stored URL with configurable fit
When a panel has `type: "image"`, the panel body SHALL render an `<img>` element sourced from the
panel's `imageUrl`. The CSS `object-fit` property SHALL be set to the panel's `imageFit` value
(`contain`, `cover`, or `fill`). When `imageFit` is absent the default SHALL be `contain`.
No DataType binding is required for image panels. `imageUrl` MAY be an absolute `http://` or
`https://` URL, or a root-relative internal upload path (`/api/uploads/image/<id>`); both SHALL
render identically. Any other value (unparseable, non-http(s) absolute scheme) SHALL be treated as
no image (placeholder rendering).

#### Scenario: Image panel with URL renders the image
- **WHEN** a panel with `type: "image"` has a non-null `imageUrl` and is displayed in the grid
- **THEN** the panel body shows an `<img>` element with `src` set to `imageUrl`
- **AND** the image fills the panel body using the configured `imageFit` value

#### Scenario: Image panel without URL renders a placeholder
- **WHEN** a panel with `type: "image"` has a null `imageUrl`
- **THEN** the panel body shows a grey placeholder with an image icon

#### Scenario: Image panel defaults to contain fit
- **WHEN** a panel with `type: "image"` has a non-null `imageUrl` and `imageFit` is null
- **THEN** the panel body renders the image with `object-fit: contain`

#### Scenario: Image panel with cover fit
- **WHEN** a panel with `type: "image"` has `imageFit: "cover"`
- **THEN** the panel body renders the image with `object-fit: cover`

#### Scenario: Image panel with fill fit
- **WHEN** a panel with `type: "image"` has `imageFit: "fill"`
- **THEN** the panel body renders the image with `object-fit: fill`

#### Scenario: Image panel with an internal upload URL renders the image
- **WHEN** a panel with `type: "image"` has `imageUrl: "/api/uploads/image/<id>"`
- **THEN** the panel body shows an `<img>` element with `src` set to that path

### Requirement: Image panel imageUrl and imageFit are settable via PATCH
The `PATCH /api/panels/:id` endpoint SHALL accept optional `imageUrl` (string or null) and
`imageFit` (one of `contain | cover | fill`, or null) fields and persist them on the panel record.

#### Scenario: PATCH sets imageUrl on an image panel
- **WHEN** a PATCH request is sent with `imageUrl: "https://example.com/logo.png"` on an image panel
- **THEN** the response includes `imageUrl: "https://example.com/logo.png"`

#### Scenario: PATCH sets imageFit on an image panel
- **WHEN** a PATCH request is sent with `imageFit: "cover"` on an image panel
- **THEN** the response includes `imageFit: "cover"`

#### Scenario: PATCH without imageUrl leaves imageUrl unchanged
- **WHEN** a PATCH request is sent without an `imageUrl` field
- **THEN** the panel's existing `imageUrl` is preserved in the response

#### Scenario: PATCH with invalid imageFit is rejected
- **WHEN** a PATCH request is sent with `imageFit: "stretch"` (not a valid value)
- **THEN** the response is 400 Bad Request

### Requirement: Panel response includes imageUrl and imageFit fields
Every panel response SHALL include `imageUrl` (string or null) and `imageFit` (string or null).
For non-image panels both fields SHALL be null.

#### Scenario: Image panel response includes imageUrl and imageFit
- **WHEN** an image panel with a stored URL and fit is retrieved
- **THEN** the response includes non-null `imageUrl` and `imageFit` values

#### Scenario: Non-image panel response has null imageUrl and imageFit
- **WHEN** a panel with type other than `image` is retrieved
- **THEN** the response includes `imageUrl: null` and `imageFit: null`

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

### Requirement: Image panel config UI supports uploading a file
The Image panel's config editor SHALL offer an "Upload" control alongside the existing URL text
field. On a successful upload, the editor SHALL set the panel's `imageUrl` to the uploaded image's
returned URL, exactly as if that URL had been typed into the text field.

#### Scenario: Uploading an image sets imageUrl
- **WHEN** a user selects a valid image file via the Image panel config's Upload control
- **THEN** the file is uploaded and the config's URL field reflects the returned upload URL
- **AND** saving the panel persists that URL as `imageUrl` via `PATCH /api/panels/:id`

#### Scenario: Upload failure surfaces an inline error
- **WHEN** an upload request fails (rejected MIME type, over size limit, or network error)
- **THEN** the config editor shows an inline error and leaves the existing `imageUrl` unchanged

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

