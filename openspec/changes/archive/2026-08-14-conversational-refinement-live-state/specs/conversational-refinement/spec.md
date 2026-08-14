## ADDED Requirements

### Requirement: A refinement turn SHALL ground Claude in the target's real current live state
`POST /api/refinements` SHALL fetch the referenced dashboard's panels or pipeline's steps directly
from the database before calling Claude, and SHALL include their real current ids/fields in the
prompt — never a cached or client-supplied snapshot.

#### Scenario: A dashboard refinement grounds in its current panels
- **WHEN** `POST /api/refinements` is called with `target: {kind: "dashboard", id: <id>}`
- **THEN** the grounding assembled for Claude reflects that dashboard's panels as they exist in the
  database at call time, including each panel's real id

#### Scenario: A pipeline refinement grounds in its current steps
- **WHEN** `POST /api/refinements` is called with `target: {kind: "pipeline", id: <id>}`
- **THEN** the grounding assembled for Claude reflects that pipeline's steps as they exist in the
  database at call time, including each step's real id

### Requirement: Grounding SHALL include workspace context and panel capabilities, not just the target's own state
The grounding assembled for Claude SHALL include workspace-wide pipeline-output DataTypes (via
`WorkspaceContextService`, HEL-345) and their panel-capability menus (via `PanelCapabilityService`,
HEL-365), in addition to the target dashboard/pipeline's own current state.

#### Scenario: A refinement that adds a not-yet-bound DataType can succeed
- **WHEN** a refinement message asks to add a panel bound to a pipeline-output DataType not currently
  used by any panel on the target dashboard
- **THEN** the grounding assembled for that call includes that DataType and its panel capabilities, so
  the returned `PatchSet` can reference it

### Requirement: A returned PatchSet SHALL already be proven valid via the apply path's own checks
The service SHALL run the parsed `PatchSet` through `PatchSetPreviewService.preview` before returning
it, and SHALL never return a patch set that `preview` itself would reject.

#### Scenario: A successful response is preview-clean
- **WHEN** `POST /api/refinements` returns `200` with a `PatchSet`
- **THEN** calling `POST /api/patch-sets/preview` with that exact patch set and the same user
  succeeds (does not reject any edit)

#### Scenario: A model output that fails preview validation is repaired once, then rejected
- **WHEN** Claude's parsed response, run through `PatchSetPreviewService.preview`, is rejected
- **THEN** exactly one repair round-trip is attempted; a second rejection returns `422`

### Requirement: The endpoint SHALL never write to any resource it references
Neither a successful nor a failed call to `POST /api/refinements` SHALL create, update, or delete any
dashboard, panel, pipeline, pipeline step, data source, or data type row.

#### Scenario: A call that produces a valid PatchSet writes nothing
- **WHEN** `POST /api/refinements` returns `200` with a `PatchSet`
- **THEN** every resource named in that patch set is byte-for-byte unchanged in the database

### Requirement: A missing or inaccessible target SHALL be rejected before any Claude call
`target.id` SHALL be resolved and ownership/ACL-checked before the first Claude call for that turn.

#### Scenario: A nonexistent or foreign-owned target is rejected up front
- **WHEN** `POST /api/refinements` is called with a `target.id` that does not exist, or is not
  accessible to the caller
- **THEN** the call is rejected (not found) and no Claude call is made
