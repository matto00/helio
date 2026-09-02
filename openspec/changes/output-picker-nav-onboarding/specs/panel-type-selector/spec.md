## REMOVED Requirements

### Requirement: Panel create modal includes a type picker as step one
**Reason**: The retired `PanelCreationModal` wizard's type-first step no longer exists; the Output picker groups by pipeline/Output rather than by panel type, with a content-panel row (text/markdown/image/divider) for non-Output panels.
**Migration**: See `output-picker`.

### Requirement: Type picker resets on modal close
**Reason**: Same as above — no persistent multi-step wizard state to reset.
**Migration**: N/A.
