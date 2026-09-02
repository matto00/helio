## REMOVED Requirements

### Requirement: Step 3 of the creation modal shows type-specific config fields
**Reason**: All per-kind visualization config (field mapping, chart/collection/timeline options) now lives on the Output, authored via `OutputEditorSheet` on the pipeline page (HEL-908) — never re-entered during placement.
**Migration**: See the pipeline page's Output editor sheet.

### Requirement: Type-specific config values are included in the creation payload
**Reason**: Same as above — `POST /api/panels` for an output panel sends only `{dashboardId, kind:"output", outputId, title?}`; no visualization config travels with a placement.
**Migration**: See `output-picker`.

### Requirement: Non-empty type-specific config fields mark the modal as dirty
**Reason**: Same as above — the picker has no config-entry step to be dirty.
**Migration**: N/A.

### Requirement: Type-specific config state resets on modal close
**Reason**: Same as above.
**Migration**: N/A.

### Requirement: Step-3 type-specific config values take effect on the created panel
**Reason**: Same as above — placement carries no visualization config.
**Migration**: See `output-panel-placement`.

### Requirement: Create endpoint accepts an optional appearance
**Reason**: Superseded by the placement-only `POST /api/panels` contract (decision 15) — appearance is set on the Panel sheet after placement, not at creation time.
**Migration**: See `panel-detail-modal` (Panel sheet) and `output-panel-placement`.
