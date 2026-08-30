## MODIFIED Requirements

### Requirement: Bulk teardown deletes exactly the resources carrying a given tag
Teardown SHALL delete every tagged resource across dashboards, panels, pipelines, and data
sources. The prior `resourceKind = "data_type"` branch no longer exists — Outputs are torn down
transitively via `ON DELETE CASCADE` from their owning pipeline, not as an independently tagged
resource kind.

#### Scenario: Tagged dashboards, panels, pipelines, and sources are deleted
- **WHEN** teardown runs for a tag present on at least one resource of each surviving kind
- **THEN** every resource carrying that tag is deleted

#### Scenario: Deleting a tagged pipeline cascades its Outputs
- **WHEN** a tagged pipeline with Outputs attached is torn down
- **THEN** its Outputs (and any panels placing them) are deleted via cascade, with no separate
  `data_type` teardown branch invoked

#### Scenario: Teardown deletes only the tagged set
- **WHEN** a caller has data sources/pipelines tagged `T` and other resources tagged
  differently or untagged, and calls `POST /api/workspace/teardown {tag: "T"}`
- **THEN** every resource tagged `T` is deleted (Outputs on a torn-down pipeline cascade with it),
  every other resource (regardless of tag) is untouched, and the response counts match exactly the
  number of resources tagged `T` per surviving kind

#### Scenario: Teardown with no matching tag deletes nothing
- **WHEN** `POST /api/workspace/teardown {tag: "nonexistent"}` is called and no owned resource
  carries that tag
- **THEN** the call succeeds with zero deletions for every kind and nothing is deleted
