## ADDED Requirements

### Requirement: Table options fit the Configuration card at desktop widths
At 1100px- and 1440px-wide viewports, a table Output's options in the Configuration card (Cell density and each
Columns row, including its format select and move controls) SHALL lie within the card's content box in both light and
dark themes, however long a column name is, and the editor sheet SHALL NOT scroll horizontally. A column name that is
truncated SHALL expose its full text (e.g. a `title`), and SHALL never be shrunk to zero width.

#### Scenario: Long column name at 1440px
- **WHEN** a table Output whose column names include one of 86 characters is open in the editor at a 1440px viewport
- **THEN** no Columns-row control's right edge extends past the Configuration card's right edge
- **AND** the sheet's scroll width equals its client width
- **AND** the long column name is visible (non-zero width) and its full text is available as the element's title

#### Scenario: Long column name at 1100px and 1024px
- **WHEN** the same Output is open at a 1100px or a 1024px viewport
- **THEN** no table option control extends past the Configuration card's right edge
- **AND** the long column name keeps a non-zero width

### Requirement: Output editor label text is contained in its control's accessible name
A visible Output-editor field label associated with a control SHALL have its text contained in that control's
accessible name (WCAG 2.5.3 Label in Name).

#### Scenario: Scatter color-by field
- **WHEN** a scatter chart Output bound to data is open in the editor
- **THEN** the combobox labelled "Color by field" has an accessible name containing "Color by field"

#### Scenario: Histogram bins field
- **WHEN** a histogram chart Output is open in the editor
- **THEN** the spinbutton labelled "Bins" has an accessible name containing "Bins"
