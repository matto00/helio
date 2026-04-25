# HEL-63: Type Registry + Data Source UX cleanup

## Context

The data sources and type registry interface has several rough UX edges that hurt usability after the core feature shipped.

## What changes

### 1. Empty state

When no data source or DataType is selected, the detail/preview area shows a large blank space with no guidance. Replace with a proper empty state: an illustration or icon, a short explanation of what to do next, and a CTA (e.g. "Add a data source" or "Select a type to preview its schema").

### 2. Immediate schema preview on selection

Clicking a DataType in the list does not immediately update the schema preview panel — users must take an additional action. The preview should update reactively the moment a type is selected, with no extra step.

### 3. Edit and delete for DataTypes and DataSources

There is currently no way to update or remove a DataType or DataSource after creation. Add:

* **Edit**: inline or modal form to update name, config, and fields
* **Delete**: delete action with a confirmation prompt; cascades appropriately (warn if bound to panels)
* Backend `PATCH` and `DELETE` endpoints if not already present

## Acceptance criteria

- [ ] Selecting nothing on the data sources page shows a meaningful empty state with a CTA, not a blank area
- [ ] Clicking a DataType in the list immediately updates the schema preview with no additional interaction
- [ ] Each DataType has an edit action that opens a pre-filled form and saves changes to the backend
- [ ] Each DataType has a delete action with a confirmation prompt; the type is removed from the list on success
- [ ] Each DataSource has an edit action and a delete action with the same behavior
- [ ] Deleting a DataSource or DataType that is bound to panels shows a warning before proceeding
