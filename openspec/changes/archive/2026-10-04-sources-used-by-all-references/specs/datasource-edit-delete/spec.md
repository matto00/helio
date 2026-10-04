## MODIFIED Requirements

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

## ADDED Requirements

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
