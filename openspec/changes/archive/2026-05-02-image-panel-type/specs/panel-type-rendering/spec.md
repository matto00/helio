## MODIFIED Requirements

### Requirement: Each panel type renders a visually distinct body
The panel grid MUST render a different body content area for each panel type (`metric`, `chart`,
`text`, `table`, `markdown`, `image`). When a panel has live mapped data or content, it SHALL
display that data; when unbound or empty, it SHALL display an appropriate placeholder.

The metric panel body SHALL render three lines when trend data is present: value, label, and trend
indicator. When `trend` is absent the metric panel body renders value and label only (two lines).

#### Scenario: Unbound metric panel renders a large value placeholder
- **WHEN** a panel with `type: "metric"` and no `typeId` is displayed in the grid
- **THEN** the panel body shows a large placeholder value (e.g. "--") with a sub-label and no trend indicator

#### Scenario: Bound metric panel renders live value and label
- **WHEN** a panel with `type: "metric"` has a `typeId` and data has been fetched and `trend` is not in the data map
- **THEN** the panel body shows the mapped `value` slot as a large value and `label` slot as a sub-label

#### Scenario: Bound metric panel with trend renders three lines
- **WHEN** a panel with `type: "metric"` has a `typeId` and bound data contains a `trend` field
- **THEN** the panel body shows value, label, and trend indicator in vertical sequence

#### Scenario: Unbound chart panel renders an empty ECharts instance
- **WHEN** a panel with `type: "chart"` and no `typeId` is displayed in the grid
- **THEN** the panel body shows an empty line chart with placeholder axes rendered by ECharts

#### Scenario: Bound chart panel renders an ECharts instance
- **WHEN** a panel with `type: "chart"` has a `typeId` and data has been fetched
- **THEN** the panel body shows an ECharts instance (chart configuration for bound data is handled in future work)

#### Scenario: Unbound text panel renders placeholder text lines
- **WHEN** a panel with `type: "text"` and no `typeId` is displayed in the grid
- **THEN** the panel body shows faded placeholder text lines

#### Scenario: Bound text panel renders live content
- **WHEN** a panel with `type: "text"` has a `typeId` and data has been fetched
- **THEN** the panel body shows the mapped `content` slot value

#### Scenario: Unbound table panel renders a table skeleton
- **WHEN** a panel with `type: "table"` and no `typeId` is displayed in the grid
- **THEN** the panel body shows a table structure with header row and placeholder data rows

#### Scenario: Bound table panel renders live rows
- **WHEN** a panel with `type: "table"` has a `typeId` and data has been fetched
- **THEN** the panel body shows actual column headers and data rows from the preview response

#### Scenario: Markdown panel with content renders CommonMark HTML
- **WHEN** a panel with `type: "markdown"` has non-null and non-empty `content` in the grid
- **THEN** the panel body renders the content as CommonMark-compliant HTML (headings, paragraphs, lists)

#### Scenario: Markdown panel with no content renders placeholder
- **WHEN** a panel with `type: "markdown"` has null or empty `content`
- **THEN** the panel body shows a faded placeholder indicating the user should add content

#### Scenario: Image panel with URL renders the image
- **WHEN** a panel with `type: "image"` has a non-null `imageUrl`
- **THEN** the panel body shows an `<img>` element with `src` set to `imageUrl` and `object-fit` set to the `imageFit` value (defaulting to `contain`)

#### Scenario: Image panel without URL renders a placeholder
- **WHEN** a panel with `type: "image"` has a null `imageUrl`
- **THEN** the panel body shows a grey placeholder with an image icon

## ADDED Requirements

### Requirement: Panel type selector includes image option
The panel type selector (used when creating or changing a panel's type) SHALL include `image`
as a selectable option alongside the existing types.

#### Scenario: Image appears in type selector
- **WHEN** the panel type selector is opened
- **THEN** `image` is listed as a valid selectable type
