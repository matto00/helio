## REMOVED Requirements

### Requirement: Panel-capability introspection endpoint
**Reason**: GET /api/types/:id/panel-capabilities is deleted along with DataTypeRoutes; capability introspection re-lands scoped to a pipeline node.
**Migration**: P1.3 adds GET /api/pipelines/:id/capabilities?stepId= (OutputBindingSpec keyed by OutputKind) as the direct replacement.

### Requirement: Panel-capability lookup is owner-scoped
**Reason**: GET /api/types/:id/panel-capabilities is deleted along with DataTypeRoutes; capability introspection re-lands scoped to a pipeline node.
**Migration**: P1.3 adds GET /api/pipelines/:id/capabilities?stepId= (OutputBindingSpec keyed by OutputKind) as the direct replacement.

### Requirement: Slot definitions share one source of truth
**Reason**: GET /api/types/:id/panel-capabilities is deleted along with DataTypeRoutes; capability introspection re-lands scoped to a pipeline node.
**Migration**: P1.3 adds GET /api/pipelines/:id/capabilities?stepId= (OutputBindingSpec keyed by OutputKind) as the direct replacement.

### Requirement: MCP capability tool
**Reason**: GET /api/types/:id/panel-capabilities is deleted along with DataTypeRoutes; capability introspection re-lands scoped to a pipeline node.
**Migration**: P1.3 adds GET /api/pipelines/:id/capabilities?stepId= (OutputBindingSpec keyed by OutputKind) as the direct replacement.

