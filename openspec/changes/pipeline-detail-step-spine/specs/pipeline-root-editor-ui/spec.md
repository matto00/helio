## MODIFIED Requirements

### Requirement: The river renders one lane column per root
The pipeline editor SHALL render every root in the pipeline's `roots[]` as the head of its own lane column, in
ascending `position` order, each labelled with the bound source's display name. No root SHALL be rendered
differently from any other on account of its position — `roots[0]` is not a trunk, not a primary, and not a
default (HEL-913 `design.md` R3). Column assignment SHALL be a pure function of the root set and step graph, so
that the same input yields byte-identical output.

Root 0's lane renders inline (no column header) when it is the ONLY root — the single-root case is
visually unchanged from before multi-root support existed. Once a second root exists, root 0 gains
the same column-header treatment (source name + remove control) as every other root (HEL-1022), so
the columns read as consistent peers; this is a rendering difference for having peers, not a
"primary root" distinction (R3 still holds — root 0 is never labelled primary/trunk).

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the spine renders one Source card per root and, under a "Steps" heading, each root's trunk in `roots` order (a quiet "From <source>" label when there are several), instead of side-by-side lane columns. A root with no steps shows its existing empty hint.

#### Scenario: Two roots render as two columns
- **WHEN** a pipeline has roots at positions 0 and 1, each with one root-level step
- **THEN** the river renders two lane columns, one headed by each root
- **THEN** each column's head names that root's bound data source
- **THEN** the column order follows ascending root `position`

#### Scenario: A single root renders with no column header
- **WHEN** a pipeline has exactly one root
- **THEN** that root's lane renders inline with no column header above it

#### Scenario: Root column layout is deterministic
- **WHEN** the layout is computed twice from the same roots and steps
- **THEN** every root's column index and every step's slot are identical between the two results

#### Scenario: A root with no steps still renders
- **WHEN** a root has been added but no step has been attached to it yet
- **THEN** that root still renders as its own column, showing an empty-lane affordance
- **AND** the column is not omitted, collapsed into another root's column, or rendered as an error

#### Scenario: Desktop one trunk per root
- **WHEN** a pipeline has two roots, the second without steps, on desktop
- **THEN** the spine shows two Source cards, root 1's numbered steps and, under "From <source>", the empty-root hint for root 2

### Requirement: The header's "+" adds a root through the inline-source flow
The header's source field group SHALL offer a "+" affordance (`AddRootModal`) that appends a root
to the pipeline, whose source is either selected from the caller's existing data sources or created
inline in the same interaction via the P1.5 `AddSourceModal` flow, matching the one `roots[]`
element shape the backend accepts (HEL-913 `design.md` R6). On success the new root SHALL appear as
a new rightmost column, and a new source chip, without a full page reload.

The river/canvas itself SHALL NOT offer its own "+ root"/"Add root" affordance (HEL-1022) — the
dashed drop-zone box the canvas previously rendered at the top-right of the step graph is removed;
adding a source is reachable only from the header's "+".

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the same flow is opened from the spine's ghost "+ Add source" under the last Source card (accessible name "Add source").

#### Scenario: Adding a root by picking an existing source
- **WHEN** the user opens the header's "+", selects an existing data source, and confirms
- **THEN** the editor issues one `POST /api/pipelines/:id/roots` carrying that source id
- **THEN** the new root renders as a new column at the highest position, and a new chip appears in
  the header

#### Scenario: Adding a root by creating a source inline
- **WHEN** the user opens the header's "+" and creates a new paste-table source without leaving the
  flow
- **THEN** the newly created source is bound to the new root
- **THEN** the user is not required to visit the sources page first

#### Scenario: The picker never submits an unset id
- **WHEN** no source has been selected and none has been created
- **THEN** the confirm control is disabled and no request is issued
- **AND** the editor never sends a root create request carrying an empty or placeholder source id

#### Scenario: The canvas has no add-root affordance of its own
- **WHEN** the pipeline editor's river/canvas is rendered
- **THEN** no "+ root"/"Add root" control is rendered above or within the step graph itself

#### Scenario: Desktop add source
- **WHEN** the user activates "+ Add source" in the spine
- **THEN** the existing add-root dialog opens and a confirmed source is added as a new root
