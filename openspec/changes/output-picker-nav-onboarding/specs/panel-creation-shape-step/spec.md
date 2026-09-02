## REMOVED Requirements

### Requirement: Shape instantiation step for data-bound panel creation
**Reason**: Pipeline shapes are now applied on the pipeline page directly ("add Outputs from a shape" against a chosen step, HEL-908/decision 7), not as a step inside panel creation.
**Migration**: See the pipeline page's `pipeline-outputs-gallery` capability.

### Requirement: Submitting instantiates and runs the shape, binding on success only
**Reason**: Same as above — shape instantiation and Output placement are now two separate, independently-completable actions (author the Output on the pipeline page, place it later from the picker).
**Migration**: See `pipeline-outputs-gallery` and `output-picker`.

### Requirement: Binding sets dataTypeId only, matching existing DataType-select behavior
**Reason**: DataTypes are retired outright; panels reference `outputId`, never `dataTypeId`.
**Migration**: See `output-panel-placement`.
