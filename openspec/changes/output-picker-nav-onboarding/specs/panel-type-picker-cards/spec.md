## REMOVED Requirements

### Requirement: Each panel type card displays icon, name, and description
**Reason**: The type-select step this capability is scoped to (`PanelCreationModal`'s Step 1) no longer exists (HEL-903 decision 8/11). Note this is a distinct capability from `panel-type-selector`, which already carries its own delta in this change.
**Migration**: See `output-picker` — Output cards (not panel-type cards) display live kind-specific previews, grouped by pipeline.

### Requirement: Selected card state is visually distinguished
**Reason**: Same as above.
**Migration**: See `output-picker`'s "already on this board" / focus-state affordances.

### Requirement: Chart card description names all four chart types
**Reason**: Same as above — there is no chart-type-picker card in the retired wizard's sense.
**Migration**: Chart-type selection now happens on the pipeline page's `OutputEditorSheet` when authoring a chart-kind Output.
