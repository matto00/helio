## REMOVED Requirements

### Requirement: Panel has a persisted type field
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

### Requirement: Panel type is updatable via PATCH
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

### Requirement: Invalid type values are rejected
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

### Requirement: Existing panels retain metric type after migration
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

### Requirement: Panel response includes DataType binding fields
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

### Requirement: PATCH accepts DataType binding fields
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

### Requirement: Panel response includes a content field
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

### Requirement: PATCH accepts a content field
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

### Requirement: Panel response includes imageUrl and imageFit fields
**Reason**: The persisted `type` enum and DataType-binding fields (`typeId`, `fieldMapping`, `refreshInterval`) are retired along with panel-DataType binding; a panel now carries `kind` (see output-panel-placement) instead. Content fields (`content`, `imageUrl`, `imageFit`) survive under output-panel-placement's "Content panels retain their literal-content fields" requirement, unchanged.
**Migration**: See output-panel-placement for the new `kind`/`output_id` shape and for the surviving content-panel fields; no functionality is lost, only relocated.

