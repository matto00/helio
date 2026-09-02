## REMOVED Requirements

### Requirement: DataType picker step for data-bound panel types during creation
**Reason**: DataTypes are retired outright (HEL-903 decision 11). Panel creation no longer has a data-bound-type concept to pick.
**Migration**: See `output-picker` — Outputs are picked directly, already carrying their own schema/config.

### Requirement: DataType picker lists only registry-produced DataTypes
**Reason**: Same as above — no DataType registry remains.
**Migration**: See `output-picker`.

### Requirement: DataType selection is required before advancing to name-entry
**Reason**: Same as above.
**Migration**: See `output-picker`.

### Requirement: Back navigation from DataType step returns to template selection
**Reason**: Same as above — the multi-step wizard this back-navigation belonged to no longer exists.
**Migration**: See `output-picker`.

### Requirement: Selected DataType ID is included in the dirty-state check
**Reason**: Same as above.
**Migration**: N/A — the Output picker has no multi-step dirty-state concept; selecting an Output places it immediately.

### Requirement: DataType step offers matching shapes for metric, chart, and table panel types
**Reason**: Same as above — pipeline shapes are now offered on the pipeline page ("add Outputs from a shape", HEL-908/decision 7), not during panel creation.
**Migration**: See the pipeline page's `pipeline-outputs-gallery` capability.

### Requirement: Selecting a shape card diverges from the existing-DataType selection path
**Reason**: Same as above.
**Migration**: See the pipeline page's `pipeline-outputs-gallery` capability.
