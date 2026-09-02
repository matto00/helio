## MODIFIED Requirements

### Requirement: DataGrid consumers rely on the variant-based density default

Every current `DataGrid` consumer SHALL render `<DataGrid>` without an explicit `density` prop, so each surface inherits the variant default (`preview` -> `condensed`, `full` -> `normal`) rather than hardcoding or duplicating density logic per surface.

Covered consumers: `TypeDetailPanel`, `SourceDetailPanel`, `StepCard`, `SqlTab`, `TableRenderer`.
(`PipelinePreviewModal` is removed from this list — HEL-908 deleted it, superseded by per-Output
previews. Its replacement, the Output editor sheet's `OutputPreviewPane`, is NOT a `DataGrid`
consumer — it renders its own plain read-only `<table>` for table/collection/timeline kinds,
deliberately not wired through `DataGrid`/`TableRenderer`, since `TableRenderer` persists
column-resize PATCHes against a `panelId` an Output sheet has no matching panel for. This is a net
reduction in `DataGrid` consumers, not a swap.) A consumer MAY pass an explicit `density` override
only when its surface has a documented reason to diverge from the variant default.

#### Scenario: Preview-variant consumers render condensed by default
- **WHEN** `TypeDetailPanel`, `SourceDetailPanel`, `StepCard`, or `SqlTab` renders its `DataGrid`
  instance
- **THEN** the rendered grid has condensed row spacing (`ui-data-grid--condensed`), matching the
  `preview` variant default

#### Scenario: Full-variant consumer renders normal by default
- **WHEN** `TableRenderer` renders its `DataGrid` instance for a table panel
- **THEN** the rendered grid has normal row spacing (`ui-data-grid--normal`), matching the `full`
  variant default
