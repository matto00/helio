## MODIFIED Requirements

### Requirement: Editable output name in footer
The footer bar SHALL display the pipeline's own name field (not a bound output-type name). The
user SHALL be able to edit the pipeline name inline.

#### Scenario: Output name is editable
- **WHEN** the user activates the pipeline name field
- **THEN** an input element is rendered allowing the name to be changed

### Requirement: Run pipeline and Dry run buttons trigger real runs
The "Run pipeline" and "Dry run" buttons in the footer bar SHALL trigger a real pipeline run over
SSE (this requirement no longer describes a placeholder; superseded by the shipped `pipeline-run-sse`
and `pipeline-dry-run-ui` capabilities).

#### Scenario: Run button shows placeholder on click
- **WHEN** the user clicks the "Run pipeline" button
- **THEN** a live run is submitted and its status streams via SSE, not a placeholder message

### Requirement: Header shows Outputs count instead of a bound output type
The page header SHALL show source, schedule, run status, and the pipeline's total Outputs count
("Outputs (N)"). The "Output type" link and any DataType-bound header field are removed; the page
SHALL NOT fetch `state.dataTypes.items` or reference `outputDataTypeName`/`outputDataTypeId`.

#### Scenario: Page header shows the output type name
- **WHEN** `PipelineDetailPage` is rendered with a loaded `currentPipeline` that has 4 Outputs
- **THEN** the page header shows "Outputs (4)" and no "Output type" link is present

### Requirement: Pipeline-sharing role does not grant source/type edit access
A pipeline-sharing `editor` or `viewer` grant (see `pipeline-sharing`) confers no ownership of the
pipeline's bound DataSource. The "Edit Source" button SHALL be gated solely on DataSource ownership
(presence in the current user's owner-scoped `sources.items`), never on pipeline ownership or
pipeline-sharing role alone. (The output-DataType half of this requirement is removed along with
the DataType concept — see `pipeline-output-type-selector`'s REMOVED Requirements.)

#### Scenario: Shared pipeline editor without source ownership sees no Edit Source button
- **WHEN** the current user has an `editor` grant on the pipeline but does not own its bound
  DataSource (it is absent from `state.sources.items`)
- **THEN** no "Edit Source" button is rendered, even though the user can edit pipeline steps

## REMOVED Requirements

### Requirement: Edit Type action is ownership-gated
**Reason**: The DataType/type-registry concept is retired by HEL-904; there is nothing left to
"edit type" for. Superseded by the Output sheet (`pipeline-output-sheet`), reachable per-Output
from the Outputs rail or gallery, which has its own per-kind, per-Output edit surface.
**Migration**: No user-facing equivalent action is needed — Outputs are edited individually via
the Output sheet rather than through a single pipeline-level "Edit type" menu item.
