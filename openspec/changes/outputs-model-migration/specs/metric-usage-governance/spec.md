## REMOVED Requirements

### Requirement: GET /api/metrics/:id/usage lists bound panels and dashboards
**Reason**: Metric usage/deprecation governance no longer applies once metrics are deleted.
**Migration**: No replacement — an Output's placements are introspected via GET /api/outputs/:id/panels (P1.3).

### Requirement: DELETE /api/metrics/:id communicates the unbound panel count
**Reason**: Metric usage/deprecation governance no longer applies once metrics are deleted.
**Migration**: No replacement — an Output's placements are introspected via GET /api/outputs/:id/panels (P1.3).

