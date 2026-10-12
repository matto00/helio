# pipeline-lane-rejoin-picker Specification

## Purpose
Defines the "other lane" secondary-input selector on the secondary-input step configs the editor exposes
(`union` and `lookup`), which lets a step consume another lane's frame instead of a data source, with
ineligible choices greyed and explained.

## Requirements

### Requirement: The secondary-input picker offers lanes alongside data sources
Every step config the editor exposes that takes a secondary input SHALL let the user choose either a data
source or another node in the same pipeline, and SHALL persist the choice in the engine's wire shape:
`{kind:"source", dataSourceId}` or `{kind:"lane", stepId}`. Today those configs are `union` and `lookup`;
`join` has no editor config at all and is out of scope here (see design.md Decision 6).

#### Scenario: Selecting another lane
- **WHEN** the user opens a `union` step's config and selects a node from another lane
- **THEN** the step's persisted config carries `secondaryInput` as `{kind:"lane", stepId}` naming that node
- **THEN** no flat `otherDataSourceId`, `rightDataSourceId` or `referenceDataSourceId` field is written

#### Scenario: Selecting a data source is unchanged
- **WHEN** the user selects a data source instead
- **THEN** the step's persisted config carries `secondaryInput` as `{kind:"source", dataSourceId}`

#### Scenario: An existing lane-kind config round-trips
- **WHEN** a step whose stored `secondaryInput` is `{kind:"lane", stepId}` is loaded into the editor
- **THEN** the picker shows that node as the current selection, not an empty or data-source selection

### Requirement: Ineligible nodes are greyed with a stated reason
The picker SHALL list every node in the pipeline other than the configuring step itself, and SHALL render
a node the engine would reject as disabled with a visible reason. The step's own ancestors SHALL be
disabled with a cycle reason; the step itself SHALL NOT be offered.

#### Scenario: An ancestor is greyed
- **WHEN** the picker is opened on a step whose ancestor chain contains node `a`
- **THEN** `a` is listed but disabled, with a visible reason stating that selecting it would form a cycle

#### Scenario: The step itself is absent
- **WHEN** the picker is opened on step `c`
- **THEN** `c` does not appear as a selectable or disabled option

#### Scenario: A non-ancestor node in any lane is selectable
- **WHEN** the picker is opened on step `c` and node `b` is neither `c` nor an ancestor of `c`
- **THEN** `b` is offered as an enabled option, whether or not `b` is its lane's terminal step, and whether
  or not `b` is already consumed by another rejoin

### Requirement: The picker imposes no ordering restriction
The picker SHALL NOT restrict selection by a node's lane index, row, or position relative to the
configuring step. Any node that is not the step itself and not one of its ancestors SHALL be selectable.

#### Scenario: A node laid out to the right is selectable
- **WHEN** node `b` sits in a lane with a higher column index than the configuring step's lane
- **THEN** `b` is offered as an enabled option

#### Scenario: A node laid out below is selectable
- **WHEN** node `b` sits at a row below the configuring step and is not one of its ancestors
- **THEN** `b` is offered as an enabled option
