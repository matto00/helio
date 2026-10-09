## MODIFIED Requirements

### Requirement: Per-kind option sets
The sheet SHALL show kind-specific option groups: chart type/axes/legend for `chart`; collection
layout for `collection`; timeline sort for `timeline`; table columns/density for `table`; a
literal markdown Content editor for `markdown` (no row binding — see "Markdown Output Content is
literal-only"); a number `format` for `metric`.

#### Scenario: Switching kind swaps the option group
- **WHEN** a user creating a new Output changes its kind from `chart` to `table`
- **THEN** the sheet replaces the chart option group with the table column/density option group

## ADDED Requirements

### Requirement: An existing Output's kind is fixed in the editor
When the Output editor sheet is opened for an existing Output, the Kind control SHALL be disabled, SHALL show the
Output's stored kind, and SHALL show a short visible reason that the kind cannot be changed after creation. The reason
SHALL be exposed to assistive technology as the Kind control's accessible description, and the disabled control SHALL
NOT be reachable by keyboard focus or open its option list. A Save from the edit sheet SHALL never send a different
kind's configuration. When the sheet is opened to create a new Output, the Kind control SHALL be enabled and SHALL show
no such reason.

#### Scenario: Edit mode shows Kind disabled with a reason
- **WHEN** a user opens the editor for an existing `chart` Output
- **THEN** the Kind control shows "Chart", is disabled, and its accessible description is the cannot-be-changed reason

#### Scenario: Disabled Kind cannot be changed
- **WHEN** a user clicks the disabled Kind control in edit mode or tabs through the sheet
- **THEN** no option list opens, focus skips the control, and the kind-specific option group stays the stored kind's

#### Scenario: Create mode is unchanged
- **WHEN** a user opens the editor to create a new Output
- **THEN** the Kind control is enabled, has no cannot-be-changed reason, and selecting another kind swaps the option group
