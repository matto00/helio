## Purpose
Defines how each panel type renders its body content area inside the dashboard grid, including placeholder states when no data is bound and live states when data is present.

## Requirements

### Requirement: Unknown panel types degrade gracefully
If a panel has an unrecognised or missing type value, the grid MUST render a fallback body rather than crashing or leaving the body blank.

#### Scenario: Panel with unknown type falls back to metric rendering
- **WHEN** a panel with an unrecognised type is displayed
- **THEN** the metric placeholder is shown as a safe fallback

### Requirement: Type badge is visible on each panel card
Each panel card in the grid MUST display the panel's type as a small visible label so users can identify the type at a glance without relying solely on the placeholder content.

#### Scenario: Type badge shown on panel card
- **WHEN** any panel is displayed in the grid
- **THEN** a small type badge showing the panel's kind (e.g. "output", "text") is visible on the card

### Requirement: Markdown panel type badge is displayed correctly
The type badge on a markdown panel card SHALL display the label "markdown" (consistent with other
panel type badges).

#### Scenario: Markdown panel shows markdown type badge
- **WHEN** a markdown panel is displayed in the grid
- **THEN** a small type badge reading "markdown" is visible on the card

### Requirement: Panel type selector includes markdown option
The panel type selector (used when creating or changing a panel's type) SHALL include `markdown`
as a selectable option alongside the existing types.

#### Scenario: Markdown appears in type selector
- **WHEN** the panel type selector is opened
- **THEN** `markdown` is listed as a valid selectable type

### Requirement: Panel type selector includes image option
The panel type selector (used when creating or changing a panel's type) SHALL include `image`
as a selectable option alongside the existing types.

#### Scenario: Image appears in type selector
- **WHEN** the panel type selector is opened
- **THEN** `image` is listed as a valid selectable type

### Requirement: Each canonical panel kind renders a visually distinct body

The panel grid MUST render a body for each canonical panel kind (`output`, `text`, `markdown`, `image`, `divider`,
`form`). A content kind (`text`, `markdown`, `image`) SHALL display its literal config when set and a placeholder when
it is empty. An `output` panel's body SHALL be chosen by the kind of the Output it is bound to (`chart`, `table`,
`metric`, `markdown`, `collection`, `timeline`). No panel kind has a `typeId` binding, and a `text` panel has no data
binding of any kind.

#### Scenario: Text panel with literal content renders it
- **WHEN** a panel with `type: "text"` has a non-empty `config.content`
- **THEN** the panel body shows that literal content

#### Scenario: Text panel without content renders placeholder text lines
- **WHEN** a panel with `type: "text"` has a null or empty `config.content`
- **THEN** the panel body shows faded placeholder text lines

#### Scenario: Markdown panel with content renders CommonMark HTML
- **WHEN** a panel with `type: "markdown"` has a non-empty `config.content`
- **THEN** the panel body renders the content as CommonMark-compliant HTML (headings, paragraphs, lists)

#### Scenario: Markdown panel with no content renders placeholder
- **WHEN** a panel with `type: "markdown"` has a null or empty `config.content`
- **THEN** the panel body shows a faded placeholder indicating the user should add content

#### Scenario: Image panel with a renderable URL renders the image
- **WHEN** a panel with `type: "image"` has a `config.imageUrl` that, resolved against the page origin, is an `http`
  or `https` URL (including a bare relative value such as `photo.png`)
- **THEN** the panel body shows an `<img>` element whose `src` is the literal value for a same-origin path starting
  with a single `/`, and otherwise the resolved absolute URL, with `object-fit` set to `config.imageFit` (defaulting
  to `contain`)

#### Scenario: Image panel without a renderable URL renders a placeholder
- **WHEN** a panel with `type: "image"` has an empty or absent `config.imageUrl`, one that cannot be parsed as a URL,
  or one that resolves to a non-`http(s)` scheme (e.g. `data:` or `javascript:`)
- **THEN** the panel body shows a placeholder with an image icon instead of an `<img>` element

#### Scenario: Image that fails to load renders a placeholder
- **WHEN** an image panel's `<img>` fails to load
- **THEN** the panel body replaces it with the image placeholder carrying load-failure copy

#### Scenario: Divider panel renders a rule
- **WHEN** a panel with `type: "divider"` is displayed in the grid
- **THEN** the panel body shows a divider in its `config.orientation`

#### Scenario: Form panel with no fields renders an unconfigured placeholder
- **WHEN** a panel with `type: "form"` has an empty field list
- **THEN** the panel body shows a "Form not configured" placeholder

#### Scenario: Output panel body follows the bound Output's kind
- **WHEN** a panel with `type: "output"` is displayed and its bound Output's metadata and rows have loaded
- **THEN** the panel body renders the renderer for that Output's kind (a chart for `chart`, a table for `table`, a
  metric value for `metric`, rendered markdown for `markdown`, a collection for `collection`, a timeline for
  `timeline`)

### Requirement: Metric-kind output panels render value, unit and label from the Output config

An `output` panel bound to a `metric`-kind Output SHALL render the metric value as a large value, with the Output's
`config.unit` immediately adjacent when non-empty (except for a duration format, whose formatted value already carries
its unit words, so the unit suffix is hidden — HEL-1308), and the Output's `config.label` as a sub-label when non-empty. The
label line SHALL be omitted, not replaced with a "No data" fallback, when a value is present but the label is empty; a
"No data" fallback SHALL be shown only when the value itself is absent.

#### Scenario: Metric value renders with its label
- **WHEN** an output panel bound to a metric-kind Output whose `config.label` is non-empty has a value
- **THEN** the panel body shows the value as a large value and the label as a sub-label

#### Scenario: Metric unit renders alongside the value
- **WHEN** an output panel bound to a metric-kind Output whose `config.unit` is non-empty and whose format is not a
  duration format has a value
- **THEN** the panel body shows the unit immediately adjacent to the value (e.g. "84 /100")

#### Scenario: Duration-formatted metric hides the unit suffix
- **WHEN** an output panel bound to a metric-kind Output with a duration format and a non-empty `config.unit` has a
  value
- **THEN** the panel body shows the formatted duration (e.g. "5m 30s") with no unit suffix

#### Scenario: Metric value with no label omits the label line
- **WHEN** an output panel bound to a metric-kind Output with an empty `config.label` has a value
- **THEN** the panel body shows the value (and unit, if set) with no label line and no "No data" text

#### Scenario: Metric with no value shows a "No data" fallback
- **WHEN** an output panel bound to a metric-kind Output has no value
- **THEN** the panel body shows the "No data" fallback text in place of the label line
