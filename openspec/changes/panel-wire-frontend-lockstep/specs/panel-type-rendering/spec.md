## MODIFIED Requirements

### Requirement: Each panel type renders a visually distinct body
The panel grid MUST render a different body content area for each panel type (`metric`, `chart`,
`text`, `table`, `markdown`, `image`, `divider`). Panel data SHALL be read from a discriminated
`config` payload keyed by the `type` discriminator; renderers MUST narrow on `type` rather than
reading flat nullable fields. When a panel has live mapped data or content, it SHALL display that
data; when unbound or empty, it SHALL display an appropriate placeholder.

The metric panel body SHALL render three lines when trend data is present: value, label, and trend
indicator. When `trend` is absent the metric panel body renders value and label only (two lines).

#### Scenario: Unbound metric panel renders a large value placeholder
- **WHEN** a panel with `type: "metric"` and an empty `config.dataTypeId` is displayed in the grid
- **THEN** the panel body shows a large placeholder value (e.g. "--") with a sub-label and no trend indicator

#### Scenario: Bound metric panel renders live value and label
- **WHEN** a panel with `type: "metric"` has a non-empty `config.dataTypeId` and data has been fetched and `trend` is not in the data map
- **THEN** the panel body shows the mapped `value` slot as a large value and `label` slot as a sub-label

#### Scenario: Bound metric panel with trend renders three lines
- **WHEN** a panel with `type: "metric"` has a non-empty `config.dataTypeId` and bound data contains a `trend` field
- **THEN** the panel body shows value, label, and trend indicator in vertical sequence

#### Scenario: Unbound chart panel renders an empty ECharts instance
- **WHEN** a panel with `type: "chart"` and an empty `config.dataTypeId` is displayed in the grid
- **THEN** the panel body shows an empty line chart with placeholder axes rendered by ECharts

#### Scenario: Bound chart panel renders an ECharts instance
- **WHEN** a panel with `type: "chart"` has a non-empty `config.dataTypeId` and data has been fetched
- **THEN** the panel body shows an ECharts instance

#### Scenario: Unbound text panel renders placeholder text lines
- **WHEN** a panel with `type: "text"` and an empty `config.content` is displayed in the grid
- **THEN** the panel body shows faded placeholder text lines

#### Scenario: Bound text panel renders live content
- **WHEN** a panel with `type: "text"` has non-empty `config.content`
- **THEN** the panel body shows the content

#### Scenario: Unbound table panel renders a table skeleton
- **WHEN** a panel with `type: "table"` and an empty `config.dataTypeId` is displayed in the grid
- **THEN** the panel body shows a table structure with header row and placeholder data rows

#### Scenario: Bound table panel renders live rows
- **WHEN** a panel with `type: "table"` has a non-empty `config.dataTypeId` and data has been fetched
- **THEN** the panel body shows actual column headers and data rows from the preview response

#### Scenario: Markdown panel with content renders CommonMark HTML
- **WHEN** a panel with `type: "markdown"` has non-empty `config.content`
- **THEN** the panel body renders the content as CommonMark-compliant HTML

#### Scenario: Markdown panel with no content renders placeholder
- **WHEN** a panel with `type: "markdown"` has empty `config.content`
- **THEN** the panel body shows a faded placeholder indicating the user should add content

#### Scenario: Image panel with URL renders the image
- **WHEN** a panel with `type: "image"` has a non-empty `config.imageUrl`
- **THEN** the panel body shows an `<img>` element with `src` set to `config.imageUrl` and `object-fit` set to `config.imageFit` (defaulting to `contain`)

#### Scenario: Image panel without URL renders a placeholder
- **WHEN** a panel with `type: "image"` has an empty `config.imageUrl`
- **THEN** the panel body shows a grey placeholder with an image icon

#### Scenario: Divider panel renders a horizontal or vertical line
- **WHEN** a panel with `type: "divider"` is displayed
- **THEN** the panel body shows a line whose orientation, weight, and color match `config.orientation`, `config.weight`, and `config.color`

## ADDED Requirements

### Requirement: Panel responses use a discriminated config wire shape
Panel response payloads SHALL carry a top-level `type` discriminator and a typed `config` object
whose shape is determined by the discriminator. This applies to `GET /api/panels`,
`GET /api/dashboards/:id/panels`, `POST /api/panels`, `PATCH /api/panels/:id`,
`POST /api/panels/:id/duplicate`, and `POST /api/panels/updateBatch`. Per-subtype nullable flat
fields (`typeId`, `fieldMapping`, `content`, `imageUrl`, `imageFit`, `dividerOrientation`,
`dividerWeight`, `dividerColor`) MUST NOT appear at the response root. Top-level fields common to
all subtypes (`id`, `dashboardId`, `title`, `type`, `meta`, `appearance`, `ownerId`) remain at the
root.

#### Scenario: Metric panel response carries metric config
- **WHEN** a metric panel is returned in any panel response
- **THEN** the response includes `type: "metric"` and `config: { dataTypeId, fieldMapping }`
- **AND** no flat `typeId`, `fieldMapping`, `content`, `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`, or `dividerColor` fields appear at the root

#### Scenario: Image panel response carries image config
- **WHEN** an image panel is returned in any panel response
- **THEN** the response includes `type: "image"` and `config: { imageUrl, imageFit }`

#### Scenario: Divider panel response carries divider config
- **WHEN** a divider panel is returned in any panel response
- **THEN** the response includes `type: "divider"` and `config: { orientation, weight, color }`
