## MODIFIED Requirements

### Requirement: The pipeline editor offers a "Start from a shape" affordance

The pipeline editor (`PipelineRiverView`) SHALL offer an "Add Outputs from a shape" control
against a chosen step, available from the Outputs rail's "+ output" affordance and from the
Outputs gallery tab's "+ New output" affordance. Selecting it SHALL open a shape picker that lists
every entry from `GET /api/pipeline-shapes`, each showing at least its `label` and `description`.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the control is the spine's ghost "Add Outputs from a shape" button under the steps (also in the empty state); a step row's "Add output" menu item and the OUTPUTS section's "+ Output" open the Output sheet. The shape picker and everything after it are unchanged, and the created steps appear as new spine rows.

#### Scenario: Shape entry point is per-step, not page-level
- **WHEN** a user activates "+ output" on a trunk step
- **THEN** the resulting menu offers "Add Outputs from a shape" scoped to that step, alongside the
  ordinary "Add output" (Output sheet) option

#### Scenario: Shape picker lists the live catalog
- **WHEN** a user opens the shape picker
- **THEN** it lists every shape returned by `GET /api/pipeline-shapes` (id `passthrough`, `single-row`,
  `top-n`, `time-series`, `pivot-matrix` at time of writing), each showing its `label` and `description`

#### Scenario: Empty pipeline shows the shape-picker affordance
- **WHEN** a user opens a pipeline with zero steps
- **THEN** the empty-state offers both "+ Add step" and an "Add Outputs from a shape" control
  scoped to the pipeline's root

#### Scenario: Non-empty pipeline shows the shape-picker affordance
- **WHEN** a user opens a pipeline with one or more existing steps
- **THEN** each step's Outputs rail and the Outputs gallery tab offer an "Add Outputs from a shape"
  control scoped to that step

#### Scenario: Desktop shape affordance
- **WHEN** the user activates "Add Outputs from a shape" in the desktop spine
- **THEN** the shape picker opens listing every shape, anchored on the last step of the first source's trunk
