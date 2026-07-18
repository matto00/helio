# divider-panel-type Specification

## Purpose
Defines the legacy divider panel type: a styled horizontal/vertical rule with configurable orientation, weight, and color (defaulting to the live `--app-border-subtle` theme token), kept rendering and editable for pre-existing dashboards while excluded from interactive creation.
## Requirements
### Requirement: Divider panel renders a styled rule

When a panel has `type: "divider"`, the panel body SHALL render a styled rule (horizontal or
vertical line). The rule's orientation SHALL be determined by `dividerOrientation`
(`"horizontal"` or `"vertical"`). When `dividerOrientation` is absent the default SHALL be
`"horizontal"`. The rule's thickness SHALL be `dividerWeight` pixels; default is `1`. The rule's
color SHALL be `dividerColor` (any valid CSS color string); when `dividerColor` is absent the
default SHALL be the live design token `--app-border-subtle`, which renders a visible neutral
line in both light and dark themes. The default MUST NOT reference a token absent from the
current theme system (`frontend/src/theme/theme.css`). No DataType binding is required or shown
for divider panels.

#### Scenario: Divider panel renders horizontal rule by default
- **WHEN** a panel with `type: "divider"` and no `dividerOrientation` is displayed in the grid
- **THEN** the panel body shows a horizontal rule spanning the panel width

#### Scenario: Divider panel renders vertical rule
- **WHEN** a panel with `type: "divider"` has `dividerOrientation: "vertical"`
- **THEN** the panel body shows a vertical rule spanning the panel height

#### Scenario: Divider panel applies configured weight
- **WHEN** a panel with `type: "divider"` has `dividerWeight: 4`
- **THEN** the rendered rule is 4 pixels thick

#### Scenario: Divider panel applies configured color
- **WHEN** a panel with `type: "divider"` has `dividerColor: "#ff0000"`
- **THEN** the rendered rule uses the color `#ff0000`

#### Scenario: Divider panel uses default weight when absent
- **WHEN** a panel with `type: "divider"` has no `dividerWeight`
- **THEN** the rendered rule is 1 pixel thick

#### Scenario: Divider panel with no color renders a visible line in both themes
- **WHEN** a panel with `type: "divider"` has no `dividerColor` (null/absent)
- **THEN** the rendered rule uses `var(--app-border-subtle)` and is visible in both light and dark themes

### Requirement: Divider fields are settable via PATCH
The `PATCH /api/panels/:id` endpoint SHALL accept optional `dividerOrientation` (one of
`"horizontal" | "vertical"`, or null), `dividerWeight` (integer ≥ 1, or null), and `dividerColor`
(string or null) fields and persist them on the panel record.

#### Scenario: PATCH sets dividerOrientation
- **WHEN** a PATCH request is sent with `dividerOrientation: "vertical"` on a divider panel
- **THEN** the response includes `dividerOrientation: "vertical"`

#### Scenario: PATCH sets dividerWeight
- **WHEN** a PATCH request is sent with `dividerWeight: 3` on a divider panel
- **THEN** the response includes `dividerWeight: 3`

#### Scenario: PATCH sets dividerColor
- **WHEN** a PATCH request is sent with `dividerColor: "#0000ff"` on a divider panel
- **THEN** the response includes `dividerColor: "#0000ff"`

#### Scenario: PATCH without divider fields leaves divider fields unchanged
- **WHEN** a PATCH request is sent without any divider fields
- **THEN** the panel's existing divider field values are preserved in the response

#### Scenario: PATCH with invalid dividerOrientation is rejected
- **WHEN** a PATCH request is sent with `dividerOrientation: "diagonal"`
- **THEN** the response is 400 Bad Request

### Requirement: Panel response includes divider fields
Every panel response SHALL include `dividerOrientation` (string or null), `dividerWeight`
(integer or null), and `dividerColor` (string or null). For non-divider panels all three fields
SHALL be null.

#### Scenario: Divider panel response includes non-null divider fields
- **WHEN** a divider panel with stored orientation, weight, and color is retrieved
- **THEN** the response includes non-null `dividerOrientation`, `dividerWeight`, and `dividerColor`

#### Scenario: Non-divider panel response has null divider fields
- **WHEN** a panel with type other than `"divider"` is retrieved
- **THEN** the response includes `dividerOrientation: null`, `dividerWeight: null`, and `dividerColor: null`

### Requirement: Divider panel can be created with an initial orientation via a dashboard proposal
`POST /api/dashboards/apply-proposal` SHALL accept an optional `orientation` field
(`"horizontal"`|`"vertical"`) per divider panel in the proposal. When present, the created panel's
`config.orientation` SHALL be set to that value at creation time. When absent, the panel SHALL be
created with the default `"horizontal"` orientation (today's behavior).

#### Scenario: Proposal-created divider panel renders its proposed orientation
- **WHEN** a dashboard proposal's panel has `type: "divider"` and `orientation: "vertical"`
- **THEN** the applied panel's `config.orientation` is `"vertical"` and the dashboard grid renders a
  vertical rule

#### Scenario: Proposal divider panel with no orientation defaults to horizontal
- **WHEN** a dashboard proposal's `divider` panel specifies no `orientation` field
- **THEN** the applied panel's `config.orientation` is `"horizontal"` (today's default)

#### Scenario: An invalid orientation is rejected before anything is created
- **WHEN** `POST /api/dashboards/apply-proposal` is called with a divider panel's `orientation` set to
  a value other than `horizontal`/`vertical`
- **THEN** the response is 400 and no dashboard or panel is created

### Requirement: Divider is a legacy-only panel type, not offered for interactive creation
The panel-type picker (`panel-type-selector`, `panel-type-picker-cards`, `panel-creation-modal` specs) SHALL NOT offer `divider` as a selectable type.
All other divider behavior in this spec — rendering,
`PATCH /api/panels/:id` support, response fields, and dashboard-proposal creation with an initial
orientation — remains unchanged and fully supported for back-compat. No database migration removes
the `dividerOrientation`/`dividerWeight`/`dividerColor` columns; no backend validation rejects
`type: "divider"` on `POST /api/panels` or `POST /api/dashboards/apply-proposal`, since dashboard
duplication and export/import reuse the same create path to clone dashboards that already contain a
divider panel.

#### Scenario: Divider panel created before HEL-249 continues to render
- **WHEN** a dashboard containing a pre-existing panel with `type: "divider"` is opened
- **THEN** the panel renders its styled rule exactly as before, with no visual or functional change

#### Scenario: Divider panel remains editable via the detail modal
- **WHEN** the user opens the detail modal for an existing divider panel
- **THEN** the Divider section (orientation, weight, color) is shown and remains editable

#### Scenario: Divider is absent from the interactive panel-type picker
- **WHEN** the user opens the panel creation modal
- **THEN** no `divider` card is present in the type-select step

#### Scenario: Duplicating a dashboard that contains a divider panel still works
- **WHEN** a dashboard containing a divider panel is duplicated or exported/imported
- **THEN** the resulting dashboard's divider panel is created with the same `orientation`/`weight`/`color`
  as the source, unaffected by the picker's removal of `divider` from interactive creation

