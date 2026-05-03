# panel-starter-templates Specification

## Purpose
TBD - created by archiving change starter-templates-panel-type. Update Purpose after archive.
## Requirements
### Requirement: Each panel type has 2–3 hardcoded starter templates
The frontend MUST define 2–3 static template configurations for every panel type. Templates SHALL be stored
as frontend constants and require no backend request to load.

#### Scenario: Templates exist for every panel type
- **WHEN** the template-select step is rendered for any panel type
- **THEN** the grid SHALL display at least 2 and at most 3 template cards for that type

#### Scenario: Templates are not fetched from the backend
- **WHEN** the template-select step renders
- **THEN** no network request SHALL be made to load template data

### Requirement: Template cards present name, description, and a blank option
The template picker MUST render each template as a selectable card showing the template label and a brief
description. A "Start blank" card SHALL always appear at the end of the grid.

#### Scenario: Template card displays label and description
- **WHEN** the template-select step is shown
- **THEN** each template card SHALL display the template label as primary text
- **AND** a one-line description as secondary text

#### Scenario: Start blank card is always present
- **WHEN** the template-select step is shown for any panel type
- **THEN** a "Start blank" card SHALL appear as the last item in the grid
- **AND** it SHALL be visually distinct from template cards (e.g. dashed border)

### Requirement: Selecting a template pre-fills the panel title
When the user selects a template card, the panel configuration form MUST be pre-filled with that
template's default title. The user MAY edit the pre-filled value before creating the panel.

#### Scenario: Template selection pre-fills title
- **WHEN** the user clicks a template card
- **THEN** the name-entry step opens
- **AND** the title input SHALL contain the template's default title value

#### Scenario: Start blank skips pre-fill
- **WHEN** the user clicks the "Start blank" card
- **THEN** the name-entry step opens
- **AND** the title input SHALL be empty

#### Scenario: Pre-filled title is editable
- **WHEN** the title input is pre-filled by a template
- **THEN** the user MAY edit or clear the value before submitting
- **AND** the panel SHALL be created with the final (possibly modified) title

