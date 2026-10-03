## REMOVED Requirements

### Requirement: Backend DELETE /api/data-sources/:id returns a structured 409 when the delete would orphan a pipeline

**Reason**: HEL-989 owner ruling widens the 409 from sole-root to any-reference; replaced by the requirement below.

## ADDED Requirements

### Requirement: Backend DELETE /api/data-sources/:id returns a structured 409 when any pipeline references the source

`DELETE /api/data-sources/:id` SHALL return **409 Conflict** whenever any pipeline has the source as a root
(`pipeline_roots`), whether the source is that pipeline's only root or one of several. The body SHALL carry
`resourceKind` (`"data_source"`), `resourceId`, `resourceName` (the source's own identity), `reason`, and `message`
(same text as `reason`), plus an additive `pipelines` array of `{id, name}` listing ONLY referencing pipelines
visible to the caller (owner or any grant). A referencing pipeline the caller cannot see SHALL NOT be named
or identified anywhere (body, message, logs at info level and above); the 409 is still returned and the reason SHALL
be non-leaky. No file SHALL be deleted and no row removed when 409 is returned. The reason SHALL direct the user to
remove the root from the pipeline in the pipeline editor first. A source no pipeline roots on SHALL delete with 204.
The body SHALL NOT leak database internals.

#### Scenario: Deleting one of several roots returns 409 and destroys nothing
- **WHEN** `DELETE /api/data-sources/:id` is called for a source that is one of several roots of a pipeline with a panel placed on that root's Output
- **THEN** the response is 409 naming the pipeline in `pipelines` and `reason`, the source, root, Output and panel all still exist

#### Scenario: Deleting a sole root returns 409
- **WHEN** the source is the only root of a pipeline
- **THEN** the response is 409 with the same body shape naming the pipeline

#### Scenario: Unreferenced source deletes
- **WHEN** no pipeline roots on the source
- **THEN** the response is 204 and the source is deleted

#### Scenario: Invisible referencing pipeline is not named
- **WHEN** the only referencing pipeline is owned by another user and the caller holds no grant on it
- **THEN** the response is 409, `pipelines` is empty, and neither its id nor its name appears in the body

#### Scenario: The 409 body does not leak database internals
- **WHEN** a delete is rejected with 409
- **THEN** the body contains no SQLSTATE, driver text or raw trigger message


### Requirement: The data-source delete UI surfaces the conflict

On a 409 from the delete call the frontend SHALL show the conflict reason and, for each entry in `pipelines`, a link
to `/pipelines/:id`, instead of the generic "Failed to delete source." message, legible in light and dark themes.

#### Scenario: Conflict shown with pipeline links
- **WHEN** the user confirms deleting a source and the API returns 409 with pipelines
- **THEN** the UI shows the reason and a link per named pipeline, and the source remains listed
