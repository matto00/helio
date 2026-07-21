## ADDED Requirements

### Requirement: Untouched appearance sentinels survive the edit-modal save

The panel edit modal MUST preserve an appearance sentinel value (`background: "transparent"`,
`color: "inherit"`) through a save when the user did not edit that specific field. Because the
color controls can only display a resolved fallback hex, the modal SHALL restore the original
sentinel in the saved appearance payload for any color field the user left untouched, and MUST
persist an explicitly chosen hex color unchanged for any field the user edited.

#### Scenario: Untouched transparent background stays transparent

- **GIVEN** a panel whose stored `appearance.background` is `"transparent"`
- **WHEN** the user opens the edit modal, changes only an unrelated field, and saves
- **THEN** the saved `appearance.background` is still `"transparent"`
- **AND** it is not replaced with the color input's fallback hex

#### Scenario: Untouched inherit text color stays inherit

- **GIVEN** a panel whose stored `appearance.color` is `"inherit"`
- **WHEN** the user opens the edit modal, changes only an unrelated field, and saves
- **THEN** the saved `appearance.color` is still `"inherit"`

#### Scenario: Explicitly chosen color persists as hex

- **GIVEN** a panel whose stored `appearance.background` is `"transparent"`
- **WHEN** the user picks a background color in the edit modal and saves
- **THEN** the saved `appearance.background` is the chosen hex value, not `"transparent"`
