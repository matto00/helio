## MODIFIED Requirements

### Requirement: TypeRegistryBrowser with inline TypeDetailPanel
The TypeRegistry section of `SourcesPage` SHALL render a `TypeRegistryBrowser` that lists all `DataType` records from Redux state. Clicking a type SHALL immediately open `TypeDetailPanel` inline showing the type's fields and name in editable form. The panel SHALL remain visible until the user explicitly closes it via the close button. Re-clicking a selected type SHALL NOT collapse the panel (toggle behavior is removed). Saving dispatches `updateDataType` (PATCH /api/types/:id) with updated name and fields.

#### Scenario: Selecting a type opens detail panel immediately
- **WHEN** the user clicks a DataType row in the registry
- **THEN** `TypeDetailPanel` appears showing the type's name (editable) and fields with editable displayName, dataType, and nullable

#### Scenario: Clicking the same type again does not close the panel
- **WHEN** TypeDetailPanel is open and the user clicks the same DataType row again
- **THEN** the panel remains open and its content does not change

#### Scenario: Closing via close button hides the panel
- **WHEN** the user clicks the close button on TypeDetailPanel
- **THEN** the panel closes and the DataType row is deselected

#### Scenario: Saving field edits
- **WHEN** the user changes a displayName and clicks "Save changes"
- **THEN** PATCH /api/types/:id is called with the updated fields array

#### Scenario: Empty registry state
- **WHEN** no DataTypes exist in Redux state
- **THEN** a meaningful empty state is displayed with guidance to add a data source
