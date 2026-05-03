# panel-creation-modal Specification

## Purpose
Defines the three-step panel creation modal: type selection, template selection, and title entry with live
preview. This spec is the contract for the multi-step dialog that guides users through panel creation.
## Requirements
### Requirement: Panel creation opens a type-first modal
When the user initiates panel creation, the UI MUST open a modal dialog. The modal MUST display a type selection step before any other configuration is shown.

#### Scenario: Add panel button opens the modal
- **WHEN** the user clicks the "Add panel" button in the panel list header
- **THEN** a modal dialog opens
- **AND** the modal shows a panel type picker as the first and only step

#### Scenario: Empty state CTA opens the modal
- **WHEN** the user clicks the "Add panel" CTA in the empty panel list
- **THEN** the same panel creation modal opens at the type selection step

### Requirement: Modal type picker presents all available panel types
The type picker step MUST offer all available panel types as selectable options. No type SHALL be hidden or disabled by default.

#### Scenario: All panel types are visible on modal open
- **WHEN** the panel creation modal opens
- **THEN** the type picker shows options for: metric, chart, text, table, markdown, image, divider

#### Scenario: User selects a panel type and advances
- **WHEN** the user selects a panel type card
- **THEN** the selection is highlighted
- **AND** the user can proceed to the next step

### Requirement: Modal second step selects a template, third step names the panel
After type selection, the modal MUST present a template picker as Step 2 before the title form (Step 3).
The title form (Step 3) MUST display a live panel preview pane alongside the form inputs. The form SHALL
be displayed in one column and the preview in a second column on viewports 600 px and wider.

#### Scenario: Template step follows type selection
- **WHEN** the user selects a panel type card
- **THEN** the template-select step is shown
- **AND** template cards for that panel type are displayed
- **AND** a "Start blank" card is shown at the end of the grid

#### Scenario: Template selection advances to name entry
- **WHEN** the user selects a template card or the "Start blank" card
- **THEN** the name-entry step is shown

#### Scenario: User can navigate back from template step
- **WHEN** the user is on the template-select step
- **AND** clicks the Back button
- **THEN** the type-select step is shown
- **AND** no template selection is retained

### Requirement: Modal dismisses without creating a panel
The user MUST be able to cancel the modal at any step without creating a panel. Dismissal MUST be
supported via the close button, the Escape key, or clicking the backdrop outside the modal content.
If the modal is in a dirty state (a panel type has been selected, a template has been selected, or
the title field is non-empty), the system MUST prompt for discard confirmation before closing.

#### Scenario: User closes modal via close button (clean)
- **WHEN** the user clicks the close button on the modal
- **AND** no data has been entered
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via close button (dirty — confirmed)
- **WHEN** the user clicks the close button on the modal
- **AND** the user has entered data
- **AND** the user confirms the discard prompt
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via Escape key (clean)
- **WHEN** the modal is open and the user presses Escape
- **AND** no data has been entered
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via Escape key (dirty — confirmed)
- **WHEN** the modal is open and the user presses Escape
- **AND** the user has entered data
- **AND** the user confirms the discard prompt
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via Escape key (dirty — cancelled)
- **WHEN** the modal is open and the user presses Escape
- **AND** the user has entered data
- **AND** the user cancels the discard prompt
- **THEN** the modal remains open with data preserved

#### Scenario: User closes modal via click outside (clean)
- **WHEN** the user clicks the backdrop area outside the modal content
- **AND** no data has been entered
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via click outside (dirty — confirmed)
- **WHEN** the user clicks the backdrop area outside the modal content
- **AND** the user has entered data
- **AND** the user confirms the discard prompt
- **THEN** the modal closes
- **AND** no panel is created

### Requirement: Modal shows inline error on create failure
If the panel create API call fails, the modal MUST display an inline error message without closing.

#### Scenario: Create request fails
- **WHEN** the backend returns an error for the panel create request
- **THEN** an inline error message is shown inside the modal
- **AND** the modal remains open for the user to retry

### Requirement: Modal state resets on close
All modal-local state (selected type, selected template, entered title, error) MUST reset when the modal
is closed, regardless of whether a panel was created.

#### Scenario: Modal resets after cancel
- **WHEN** the user cancels or closes the modal without creating a panel
- **AND** reopens the modal
- **THEN** the type picker step is shown with no type pre-selected
- **AND** any previously selected template is cleared
- **AND** any previously entered title is cleared

#### Scenario: Modal resets after successful create
- **WHEN** the user creates a panel and the modal closes
- **AND** the user opens the modal again
- **THEN** the type picker step is shown with no type pre-selected

