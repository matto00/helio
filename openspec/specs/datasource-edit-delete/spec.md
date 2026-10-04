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

The Sources sidebar list, and the empty-schema affordance's delete confirm, SHALL warn while a source delete is pending
confirmation whenever the source is referenced by any of the reference kinds the delete guard refuses on: a pipeline
root, a join/lookup/union secondary input, an upsert existing-source target, or a form-panel binding. The warning SHALL
be derived from the server's reference summary (`GET /api/data-sources/references`), never from a client-side count
over the pipelines list, and SHALL count visible and hidden referencing pipelines and form panels alike, e.g.
"1 pipeline and 1 form panel reference this source, so deleting it will be refused until you remove those references."
The warning SHALL name no resource the caller cannot see.

The user may proceed or cancel. The delete call remains `DELETE /api/data-sources/:id`; on success the source is removed
from the list, and on 409 the conflict notice is shown.

#### Scenario: Delete warns for a source referenced only by a join secondary input

- **WHEN** the user selects Delete for a source whose only reference is a join, lookup or union step's secondary input
- **THEN** a warning counting that pipeline is shown alongside the Confirm/Cancel pair

#### Scenario: Delete warns for a source referenced only by a form panel or upsert target

- **WHEN** the user selects Delete for a source whose only reference is a form panel binding or an upsert target
- **THEN** a warning counting that form panel or pipeline is shown alongside the Confirm/Cancel pair

#### Scenario: Hidden references are counted

- **WHEN** the only references are held by a pipeline or dashboard the caller cannot access
- **THEN** the warning counts them and contains no name or id of the hidden resource

#### Scenario: Delete DataSource with a dependent pipeline warns user

- **WHEN** the user selects Delete for a source the reference summary lists a root-referencing pipeline for
- **THEN** a warning counting that pipeline is displayed alongside the Confirm/Cancel pair

#### Scenario: Dependent match is not restricted to the first root

- **WHEN** the user selects Delete for a source that a multi-root pipeline reads from via a root other than its first,
  as reported by the reference summary
- **THEN** that pipeline is included in the count and the warning is displayed

#### Scenario: Delete DataSource with no dependent pipelines shows no warning

- **WHEN** the user selects Delete for a source the reference summary lists no reference for
- **THEN** no dependency warning is shown, only the plain Confirm/Cancel pair

#### Scenario: Proceeding deletes the source

- **WHEN** the user confirms deletion and the source has no reference
- **THEN** `DELETE /api/data-sources/:id` is called and the source is removed from the list

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

### Requirement: Backend DELETE /api/data-sources/:id returns a structured 409 when any pipeline references the source

`DELETE /api/data-sources/:id` SHALL return **409 Conflict** whenever the source is referenced by any live
configuration: a pipeline root (sole or one of several), a join, lookup or union step whose secondary input is this
source, an upsert step whose target is this existing source, or a form panel bound to this source. The set of
reference kinds SHALL be the complete set of persisted configuration references to a data source.

The body SHALL carry `resourceKind` (`"data_source"`), `resourceId`, `resourceName` (the source's own identity),
`reason`, and `message` (same text as `reason`), plus the additive `pipelines` array of `{id, name, references}`
(`references` lists the reference kinds that pipeline holds: `root`, `join`, `lookup`, `union`, `upsertTarget`) and
an additive `panels` array of `{id, title, dashboardId, dashboardName}`, plus additive integer fields
`hiddenPipelineCount` and `hiddenPanelCount`: the number of distinct referencing pipelines and form panels the caller
cannot see, counts only, never carrying an identity. Each array SHALL list ONLY referencing
resources visible to the caller: a pipeline the caller owns or holds a sharing grant on as the named grantee; a panel
whose dashboard the caller owns or holds a sharing grant on as the named grantee. A grant to any other user, and a
public-viewer (grantee-less) grant, SHALL NOT make a resource visible to the caller. A referencing resource the caller cannot see SHALL NOT be named or identified anywhere (body,
message, logs at info level and above); the 409 is still returned and the reason SHALL mention such references only
as an unnamed count. No file SHALL be deleted and no row removed when 409 is returned. The reason SHALL direct the
user to remove each reference first. A source with no reference SHALL delete with 204. The body SHALL NOT leak
database internals.

#### Scenario: Deleting one of several roots returns 409 and destroys nothing
- **WHEN** `DELETE /api/data-sources/:id` is called for a source that is one of several roots of a pipeline with a panel placed on that root's Output
- **THEN** the response is 409 naming the pipeline in `pipelines` (with `references` containing `root`) and `reason`, and the source, root, Output and panel all still exist

#### Scenario: Deleting a sole root returns 409
- **WHEN** the source is the only root of a pipeline
- **THEN** the response is 409 with the same body shape naming the pipeline

#### Scenario: Secondary input of a join, lookup or union blocks the delete
- **WHEN** the source is not a root of any pipeline but is the `source`-kind secondary input of a join, lookup or union step in a pipeline visible to the caller
- **THEN** the response is 409, `pipelines` names that pipeline with the matching kind in `references`, and the source and its backing file still exist

#### Scenario: Upsert target blocks the delete
- **WHEN** the source is the `existingSource` target of an upsert step in a pipeline visible to the caller
- **THEN** the response is 409 and `pipelines` names that pipeline with `upsertTarget` in `references`

#### Scenario: Form panel binding blocks the delete
- **WHEN** a form panel on a dashboard visible to the caller is bound to the source
- **THEN** the response is 409 and `panels` names that panel with its dashboard id and name

#### Scenario: Unreferenced source deletes
- **WHEN** nothing references the source, including a lane-kind secondary input, an upsert creating a new source, or an empty draft secondary input
- **THEN** the response is 204 and the source is deleted

#### Scenario: Invisible referencing pipeline is not named
- **WHEN** the only referencing pipeline is owned by another user and the caller holds no grant on it
- **THEN** the response is 409, `pipelines` is empty, and neither its id nor its name appears in the body

#### Scenario: Invisible referencing pipeline and form panel are not named
- **WHEN** the only references are a pipeline and a form panel owned by another user, and the caller holds no grant on that pipeline or that panel's dashboard
- **THEN** the response is 409, `pipelines` and `panels` are empty, and neither resource's id nor name appears in the body

#### Scenario: A grant to someone else does not make a reference visible
- **WHEN** the referencing pipeline is owned by another user and shared with a third user (not the caller), and the referencing form panel's dashboard is owned by another user and shared with a third user and publicly
- **THEN** the response is 409 and neither resource is named or identified in the body

#### Scenario: The 409 body does not leak database internals
- **WHEN** a delete is rejected with 409
- **THEN** the body contains no SQLSTATE, driver text or raw trigger message

### Requirement: The data-source delete UI surfaces the conflict

On a 409 from the delete call the frontend SHALL show a notice, instead of the generic "Failed to delete source."
message, that it composes from the structured body: for each entry in `pipelines` a link to `/pipelines/:id`, for
each entry in `panels` its title and a link to `/dashboards/:dashboardId`, each visible reference exactly once, and a
statement of `hiddenPipelineCount`/`hiddenPanelCount` when non-zero. The notice SHALL render no raw resource id. It
SHALL fall back to the server `message` only when the body carries no structured references or counts (an older
server). It SHALL be legible in light and dark themes and SHALL NOT describe a non-root reference as a root.

#### Scenario: Conflict shown with pipeline links
- **WHEN** the user confirms deleting a source and the API returns 409 with pipelines
- **THEN** the UI shows a composed notice with a link per named pipeline and no raw id, and the source remains listed

#### Scenario: Conflict shown with form panel links
- **WHEN** the API returns 409 with panels
- **THEN** the UI shows each panel's title with a link to its dashboard

#### Scenario: Only hidden references
- **WHEN** the API returns 409 with empty `pipelines` and `panels` and non-zero hidden counts
- **THEN** the UI states the hidden counts (e.g. "a pipeline you cannot access") and renders no link and no id

#### Scenario: Mixed visible and hidden references
- **WHEN** the API returns 409 naming one visible pipeline with `hiddenPanelCount` 1
- **THEN** the UI links the visible pipeline once and states the hidden form panel count, with no raw id

### Requirement: Backend GET /api/data-sources/references returns every source's reference summary

The backend SHALL expose `GET /api/data-sources/references` returning `{"items": [...]}` with one entry per data source
the caller owns that has at least one reference, each `{sourceId, pipelines, panels, hiddenPipelineCount,
hiddenPanelCount}` where `pipelines` entries are `{id, name, references}` and `panels` entries are
`{id, title, dashboardId, dashboardName}` — the same reference kinds and the same visibility as the
`DELETE /api/data-sources/:id` 409 body. Referencing resources the caller cannot see SHALL appear only in the hidden
counts, with no id or name anywhere in the response, including when the connection role is subject to row-level
security. A source the caller does not own SHALL never appear. The response SHALL be computed with a number of
database queries independent of the number of sources.

#### Scenario: Every reference kind is reported

- **WHEN** the caller owns sources referenced respectively as a root, a join input, an upsert target and a form panel
- **THEN** each appears in `items` with the matching pipeline `references` kind or panel entry

#### Scenario: Hidden references are counts only under RLS

- **WHEN** the caller's source is referenced by another user's pipeline and form panel with no grant to the caller,
  and the server connects as a role without BYPASSRLS
- **THEN** that source's entry has `hiddenPipelineCount` 1 and `hiddenPanelCount` 1, empty `pipelines` and `panels`,
  and the response contains no id or name of the hidden pipeline, panel or dashboard

#### Scenario: Unreferenced and foreign sources are absent

- **WHEN** a caller-owned source has no reference, or a referenced source belongs to another user
- **THEN** neither appears in the caller's `items`

### Requirement: Sources "Used by" reflects every reference kind

The Sources page "Used by" column SHALL be derived from the server reference summary and SHALL count referencing
pipelines (any kind) and form panels, visible and hidden. It SHALL read "Unused" only once the summary has loaded and
lists no reference for the source, and SHALL NOT claim "Unused" before the summary has loaded. Its tooltip SHALL name
only visible resources and state hidden ones as a count. It SHALL be legible in light and dark themes.

#### Scenario: Join-only source is shown as used

- **WHEN** a source's only reference is a join secondary input
- **THEN** its "Used by" cell reads "1 pipeline", not "Unused"

#### Scenario: Form-panel-only source is shown as used

- **WHEN** a source's only reference is a form panel binding
- **THEN** its "Used by" cell reads "1 form panel"

#### Scenario: Summary not yet loaded

- **WHEN** the reference summary has not loaded
- **THEN** the cell does not read "Unused"
