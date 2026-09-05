# pipeline-root-editor-ui Specification

## ADDED Requirements

### Requirement: The river renders one lane column per root
The pipeline editor SHALL render every root in the pipeline's `roots[]` as the head of its own lane column, in
ascending `position` order, each labelled with the bound source's display name. No root SHALL be rendered
differently from any other on account of its position — `roots[0]` is not a trunk, not a primary, and not a
default (HEL-913 `design.md` R3). Column assignment SHALL be a pure function of the root set and step graph, so
that the same input yields byte-identical output.

#### Scenario: Two roots render as two columns
- **WHEN** a pipeline has roots at positions 0 and 1, each with one root-level step
- **THEN** the river renders two lane columns, one headed by each root
- **THEN** each column's head names that root's bound data source
- **THEN** the column order follows ascending root `position`

#### Scenario: Root column layout is deterministic
- **WHEN** the layout is computed twice from the same roots and steps
- **THEN** every root's column index and every step's slot are identical between the two results

#### Scenario: A root with no steps still renders
- **WHEN** a root has been added but no step has been attached to it yet
- **THEN** that root still renders as its own column, showing an empty-lane affordance
- **AND** the column is not omitted, collapsed into another root's column, or rendered as an error

### Requirement: "+ root" adds a root through the inline-source flow
The editor SHALL offer an affordance that appends a root to the pipeline, whose source is either selected from
the caller's existing data sources or created inline in the same interaction via the P1.5 `AddSourceModal` flow,
matching the one `roots[]` element shape the backend accepts (HEL-913 `design.md` R6). On success the new root
SHALL appear as a new rightmost column without a full page reload.

#### Scenario: Adding a root by picking an existing source
- **WHEN** the user opens "+ root", selects an existing data source, and confirms
- **THEN** the editor issues one `POST /api/pipelines/:id/roots` carrying that source id
- **THEN** the new root renders as a new column at the highest position

#### Scenario: Adding a root by creating a source inline
- **WHEN** the user opens "+ root" and creates a new paste-table source without leaving the flow
- **THEN** the newly created source is bound to the new root
- **THEN** the user is not required to visit the sources page first

#### Scenario: The picker never submits an unset id
- **WHEN** no source has been selected and none has been created
- **THEN** the confirm control is disabled and no request is issued
- **AND** the editor never sends a root create request carrying an empty or placeholder source id

### Requirement: Removing a root reports its destructive blast radius
Before removing a root the editor SHALL tell the user how many panel placements will be destroyed along with
that root's lane and Outputs, in the same terms step deletion already uses. The editor SHALL surface the
backend's named refusals — removing the last remaining root, and removing a root whose nodes a surviving lane
still references — as specific, actionable messages rather than as a generic failure.

#### Scenario: Removal reports the placement count
- **WHEN** the user asks to remove a root whose lane's Outputs are placed on three panels
- **THEN** the confirmation states that three placements will be removed
- **THEN** no delete request is issued until the user confirms

#### Scenario: Removing the last root is refused
- **WHEN** the pipeline has exactly one root and the user attempts to remove it
- **THEN** the editor reports that a pipeline must keep at least one root
- **AND** the pipeline's root set is unchanged

#### Scenario: A dangling lane reference is refused with its cause
- **WHEN** the backend refuses removal because a surviving lane's rejoin references a node in the removed lane
- **THEN** the editor names the referencing step in the message it shows
- **AND** the pipeline's root set is unchanged

### Requirement: Lane paths render in the multi-root node-path format
Where the editor displays a node's path it SHALL use the multi-root runtime format pinned by HEL-913
`design.md` R5 — the ordered ids from the originating root to the target node inclusive, joined by `" > "`,
with the root segment rendered as a root reference rather than the bare literal `root`. Display names MAY be
substituted for ids at render time. The superseded single-root form (a bare `root` head, as in `root > s1 > s4`)
SHALL NOT be rendered.

#### Scenario: A path names its originating root
- **WHEN** a node's path is displayed in a pipeline with two roots
- **THEN** the path's first segment identifies which root the node descends from
- **AND** the first segment is not the bare literal `root`

#### Scenario: A node reachable from several roots renders one canonical path
- **WHEN** a rejoin node consumes lanes originating at two different roots
- **THEN** exactly one path is rendered for it, through the lowest-positioned originating root

### Requirement: Root columns stack on narrow viewports without breaking touch targets
Root columns SHALL remain usable on mobile viewports: at 375px and 430px widths the columns SHALL stack or
scroll rather than overflow the viewport unreachably, and every interactive control introduced by this
capability — the "+ root" affordance and each root's remove control — SHALL meet the project's >=44px
touch-target minimum.

#### Scenario: Two root columns at 375px
- **WHEN** a two-root pipeline is viewed at a 375px viewport width
- **THEN** both roots remain reachable, and no root column is clipped out of reach
- **THEN** the "+ root" and root remove controls each measure at least 44px in both dimensions

#### Scenario: Two root columns at 430px
- **WHEN** the same pipeline is viewed at a 430px viewport width
- **THEN** the same reachability and touch-target guarantees hold
