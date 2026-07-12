## ADDED Requirements

### Requirement: DataGrid consumers rely on the variant-based density default

Every current `DataGrid` consumer SHALL render `<DataGrid>` without an explicit `density` prop, so each surface inherits the variant default (`preview` -> `condensed`, `full` -> `normal`) rather than hardcoding or duplicating density logic per surface.

Covered consumers: `TypeDetailPanel`, `SourceDetailPanel`, `PipelinePreviewModal`, `StepCard`,
`SqlTab`, `TableRenderer`. A consumer MAY pass an explicit `density` override only when its surface
has a documented reason to diverge from the variant default.

#### Scenario: Preview-variant consumers render condensed by default
- **WHEN** `TypeDetailPanel`, `SourceDetailPanel`, `PipelinePreviewModal`, `StepCard`, or `SqlTab`
  renders its `DataGrid` instance
- **THEN** the rendered grid has condensed row spacing (`ui-data-grid--condensed`), matching the
  `preview` variant default

#### Scenario: Full-variant consumer renders normal by default
- **WHEN** `TableRenderer` renders its `DataGrid` instance for a table panel
- **THEN** the rendered grid has normal row spacing (`ui-data-grid--normal`), matching the `full`
  variant default

### Requirement: DataGrid density spacing and type scale match project design tokens

`DataGrid`'s per-density CSS rules SHALL use the project's spacing (`--space-*`) and type (`--text-*`) design tokens for padding and font size, rather than hardcoded pixel values.

This keeps density changes consistent with `DESIGN.md`'s spacing and type scales as those scales evolve.

#### Scenario: Each density mode uses design-token values
- **WHEN** `DataGrid` renders in `condensed`, `normal`, or `spacious` density
- **THEN** the cell padding and font size for that mode are set via `--space-*` and `--text-*`
  custom properties, not hardcoded pixel literals
