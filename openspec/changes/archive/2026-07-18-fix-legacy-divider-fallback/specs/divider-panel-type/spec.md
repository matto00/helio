# divider-panel-type Delta

## MODIFIED Requirements

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
