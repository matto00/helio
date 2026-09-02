## REMOVED Requirements

### Requirement: Empty state with pipeline CTA when no registry DataTypes exist
**Reason**: DataTypes are retired outright. The equivalent empty state is the Output picker's own "No output fits? New pipeline · Ask the assistant" affordance.
**Migration**: See `output-picker`.

### Requirement: Empty state is not shown while pipelines or DataTypes are loading
**Reason**: Same as above.
**Migration**: See `output-picker`.

### Requirement: A data-type filter matching nothing renders an empty state, not a bare status line
**Reason**: Same as above — the picker's search/filter is over Outputs, not DataTypes, but the same "empty state, not a bare status line" behavior is preserved there.
**Migration**: See `output-picker`.
