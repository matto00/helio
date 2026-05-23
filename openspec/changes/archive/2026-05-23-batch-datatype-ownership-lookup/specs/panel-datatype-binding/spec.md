## ADDED Requirements

### Requirement: DataType ownership lookup is batched on dashboard panel reads
When loading panels for a dashboard, the system SHALL resolve DataType ownership for all typed panels
using a single database query, not one query per panel. Panels whose `typeId` does not resolve to an
owned DataType SHALL have their binding cleared (typeId set to null), preserving existing semantics.

#### Scenario: Multiple typed panels produce a single ownership query
- **WHEN** `GET /api/dashboards/:id/panels` is called for a dashboard with N panels that have a typeId
- **THEN** exactly one SQL query is issued to verify DataType ownership (not N queries)
- **AND** the response panels are identical to what N individual queries would have produced

#### Scenario: Panels with no typeId are not affected
- **WHEN** all panels on a dashboard have a null typeId
- **THEN** no DataType ownership query is issued at all

#### Scenario: Mixed panel list clears unowned typeIds
- **WHEN** a dashboard has panels where some typeIds belong to the requesting user and some do not
- **THEN** panels with owned typeIds are returned with their typeId intact
- **AND** panels with unowned typeIds are returned with typeId null
