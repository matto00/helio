## MODIFIED Requirements

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

### Requirement: Panel response includes imageUrl and imageFit fields
Every panel response SHALL include `imageUrl` (string or null) and `imageFit` (string or null).
For non-image panels both fields SHALL be null.

#### Scenario: Image panel response includes imageUrl and imageFit
- **WHEN** an image panel with a stored URL and fit is retrieved
- **THEN** the response includes non-null `imageUrl` and `imageFit` values

#### Scenario: Non-image panel response has null imageUrl and imageFit
- **WHEN** a panel with type other than `image` is retrieved
- **THEN** the response includes `imageUrl: null` and `imageFit: null`

## ADDED Requirements

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
