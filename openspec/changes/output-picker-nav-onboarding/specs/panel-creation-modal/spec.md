## REMOVED Requirements

### Requirement: Panel creation opens a type-first modal
**Reason**: HEL-903 (Pipelines & Outputs remodel) retires the multi-step, type-first `PanelCreationModal` entirely. "Add panel" no longer walks a type→template→DataType→name wizard.
**Migration**: See the new `output-picker` capability (this same change) — a single searchable modal grouped by pipeline replaces every step of this wizard.

### Requirement: Modal type picker presents all available panel types
**Reason**: Same as above — there is no longer a standalone type-selection step; the Output picker groups by pipeline/Output, with a content-panel row (text/markdown/image/divider) at the bottom.
**Migration**: See `output-picker`.

### Requirement: Modal second step selects a template, third step (data-bound types only) selects a DataType, final step names the panel
**Reason**: DataTypes are retired outright (HEL-903 decision 11); panels place Outputs, not DataType-bound configuration built up over four screens.
**Migration**: See `output-picker` — one click on an Output places it at the next free slot with the server-owned default size (decision 15).
