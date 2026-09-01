## REMOVED Requirements

### Requirement: A per-DataType assertion-status read reports whether the latest run had an error-severity failure
**Reason**: `GET /api/types/:id/assertion-status` is deleted along with `DataTypeRoutes` (decision 11); a panel bound to a DataType no longer exists (panels are Output placements, see `output-panel-placement`).
**Migration**: P1.3 (HEL-906) adds `GET /api/outputs/:id/assertion-status` as the direct backend replacement (ticket.md's API & contracts section); the frontend invalid-data badge is rebuilt against it in P1.6 (HEL-909) alongside the rest of the dashboard/panel-rendering rebuild.

### Requirement: A panel bound to an invalid DataType shows an informational badge
**Reason**: `GET /api/types/:id/assertion-status` is deleted along with `DataTypeRoutes` (decision 11); a panel bound to a DataType no longer exists (panels are Output placements, see `output-panel-placement`).
**Migration**: P1.3 (HEL-906) adds `GET /api/outputs/:id/assertion-status` as the direct backend replacement (ticket.md's API & contracts section); the frontend invalid-data badge is rebuilt against it in P1.6 (HEL-909) alongside the rest of the dashboard/panel-rendering rebuild.

