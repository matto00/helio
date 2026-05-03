# panel-creation-preview Specification

## Purpose
TBD - created by archiving change live-panel-preview. Update Purpose after archive.
## Requirements
### Requirement: Panel creation modal shows a live preview pane on the name-entry step
The `name-entry` step of the panel creation modal MUST render a preview pane alongside the form.
The preview pane MUST display the selected panel type using the same rendering component used in
the dashboard grid (`PanelContent`), in its unbound/placeholder state.

#### Scenario: Preview renders the selected panel type
- **WHEN** the user has selected a panel type and is on the name-entry step
- **THEN** the preview pane SHALL display a representative render of that panel type

#### Scenario: Preview shows placeholder state for data-bound types
- **WHEN** the selected type is metric, chart, table, or text
- **THEN** the preview SHALL display the type's unbound placeholder (e.g. "--" for metric, empty chart axes for chart)
- **AND** no data source connection is required or shown

### Requirement: Panel preview title updates live as the user types
The preview pane MUST display a panel title label that updates in real-time as the user types in
the title input field.

#### Scenario: Preview reflects current title input value
- **WHEN** the user types in the panel title input
- **THEN** the preview pane title label SHALL update to match the current input value without delay

#### Scenario: Preview shows fallback title when input is empty
- **WHEN** the title input is empty
- **THEN** the preview pane SHALL display a neutral placeholder label (e.g. "Untitled")
- **AND** the placeholder SHALL be visually distinct from a real title (e.g. muted color)

### Requirement: Preview pane is styled to resemble a dashboard panel card
The preview pane MUST be framed to visually match the dashboard panel card appearance, using
panel design tokens (border, background, border-radius).

#### Scenario: Preview card matches panel card visual treatment
- **WHEN** the name-entry step is displayed
- **THEN** the preview container SHALL have a border, background, and border-radius consistent
  with the panel cards rendered in the dashboard grid

### Requirement: Preview is hidden on narrow viewports
On viewports narrower than 600 px the preview pane SHALL be hidden so that the form is not
crowded on mobile-sized screens.

#### Scenario: Preview hidden below breakpoint
- **WHEN** the modal is rendered on a viewport narrower than 600 px
- **THEN** the preview pane SHALL not be visible
- **AND** the form SHALL occupy the full modal width

