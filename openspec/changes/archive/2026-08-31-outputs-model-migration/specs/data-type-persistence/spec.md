## REMOVED Requirements

### Requirement: Data types are persisted in the database
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

### Requirement: DataTypeRepository provides async CRUD
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

### Requirement: DataTypeRepository can check if a type is bound to any panel
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

### Requirement: data_types table has an owner_id column
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

### Requirement: DataType domain model carries ownerId
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

### Requirement: DataTypeRepository.findAll filters by ownerId
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

### Requirement: DataTypeRepository.findById with ownerId guard supports cross-user unbound resolution
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

### Requirement: Companion DataTypes are internal source-schema records
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

### Requirement: One-time migration converts panel-bound companion types (V41)
**Reason**: DataType/companion-type persistence is retired; outputs-model and data-source-persistence (inferredSchema) replace it.
**Migration**: The one-time migration copies companion-type schemas to data_sources.inferred_schema and pipeline-output types to Output rows before dropping data_types.

