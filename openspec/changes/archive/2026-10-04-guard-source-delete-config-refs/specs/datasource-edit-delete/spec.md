## MODIFIED Requirements

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
