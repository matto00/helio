# image-panel-type Specification

## Purpose
TBD - created by archiving change image-panel-type. Update Purpose after archive.
## Requirements
### Requirement: Image panel renders a stored URL with configurable fit
When a panel has `type: "image"`, the panel body SHALL render an `<img>` element sourced from the
panel's `imageUrl`. The CSS `object-fit` property SHALL be set to the panel's `imageFit` value
(`contain`, `cover`, or `fill`). When `imageFit` is absent the default SHALL be `contain`.
No DataType binding is required for image panels.

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

