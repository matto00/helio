# datasource-edit-delete Specification

## Purpose
Edit and delete operations for DataSources and DataTypes from the Sources page: inline rename for DataSources, editable name field for DataTypes, delete with bound-panel warnings, and a backend PATCH endpoint for DataSource rename.
## Requirements
### Requirement: Delete DataType from TypeRegistryBrowser
`TypeRegistryBrowser` SHALL render a delete button for each DataType row. Clicking it SHALL show an inline confirmation prompt. Confirming SHALL dispatch `deleteDataType` (DELETE /api/types/:id). On 409 from the backend the component SHALL display a warning: "One or more panels are bound to this type. Unbind them before deleting." On success the DataType SHALL be removed from the list.

#### Scenario: Delete button triggers confirmation
- **WHEN** the user clicks the delete button for a DataType row
- **THEN** an inline confirmation prompt appears asking the user to confirm deletion

#### Scenario: Confirmed delete removes the type
- **WHEN** the user confirms deletion and DELETE /api/types/:id returns 204
- **THEN** the DataType is removed from the Redux list and the row disappears

#### Scenario: Delete rejected when bound to panels
- **WHEN** the user confirms deletion and DELETE /api/types/:id returns 409
- **THEN** the confirmation is dismissed and a warning message is shown explaining the type is bound to panels

#### Scenario: Cancelling delete shows no change
- **WHEN** the user clicks the delete button then clicks Cancel
- **THEN** the DataType row remains and no API call is made

### Requirement: Edit DataType name from TypeDetailPanel
`TypeDetailPanel` SHALL expose a name field that is editable. Saving SHALL include the updated name in the PATCH /api/types/:id request alongside the fields array. The panel header and the corresponding list row SHALL reflect the updated name on success.

#### Scenario: Name field is editable
- **WHEN** the TypeDetailPanel is open for a selected DataType
- **THEN** the DataType name is rendered in an editable input (not just a heading)

#### Scenario: Name update is sent on save
- **WHEN** the user changes the name input and clicks "Save changes"
- **THEN** PATCH /api/types/:id is called with the updated name and the panel header reflects the new name

### Requirement: Rename DataSource inline in DataSourceList
`DataSourceList` SHALL provide an edit (pencil) button for each source. Clicking it SHALL replace the source name with an editable input. Pressing Enter or clicking a confirm button SHALL dispatch `updateSource` (PATCH /api/data-sources/:id). Pressing Escape or clicking Cancel SHALL revert to the read-only name without an API call.

#### Scenario: Edit button activates inline name input
- **WHEN** the user clicks the edit button for a DataSource row
- **THEN** the source name becomes an editable input pre-filled with the current name

#### Scenario: Confirm saves the new name
- **WHEN** the user edits the name and presses Enter (or clicks Save)
- **THEN** PATCH /api/data-sources/:id is called with the new name and the list row displays the updated name

#### Scenario: Escape cancels without saving
- **WHEN** the user activates inline edit and presses Escape
- **THEN** the original name is restored and no API call is made

### Requirement: Delete DataSource shows bound-panel warning for related DataTypes
When deleting a DataSource whose associated DataType is bound to panels, `DataSourceList` SHALL surface a warning: "This source has a type bound to one or more panels. Deleting it will also remove those type bindings." The user may proceed or cancel. The delete call SHALL be `DELETE /api/data-sources/:id` and remove the source from the list.

#### Scenario: Delete DataSource with bound DataType warns user
- **WHEN** the user clicks Delete for a DataSource and its associated DataType is bound to panels
- **THEN** a warning message is displayed before the final confirmation prompt

#### Scenario: Proceeding deletes the source
- **WHEN** the user confirms deletion after the warning
- **THEN** DELETE /api/data-sources/:id is called and the source is removed from the list

### Requirement: Backend PATCH /api/data-sources/:id renames a DataSource
The backend SHALL expose `PATCH /api/data-sources/:id` accepting `{ "name": "<new name>" }` (optional field). The endpoint SHALL update the DataSource name and return 200 with the updated DataSource. ACL rules (owner-only) SHALL apply. A missing or unknown id SHALL return 404.

#### Scenario: Rename succeeds
- **WHEN** PATCH /api/data-sources/:id is called with a valid name
- **THEN** the response is 200 with the updated DataSource including the new name

#### Scenario: Rename non-existent source returns 404
- **WHEN** PATCH /api/data-sources/:id is called with an unknown id
- **THEN** the response is 404

#### Scenario: Rename with empty name is rejected
- **WHEN** PATCH /api/data-sources/:id is called with an empty string name
- **THEN** the response is 400 with a descriptive error message

