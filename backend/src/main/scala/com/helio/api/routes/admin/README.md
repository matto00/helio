# Routes — Admin

`GET /api/admin/usage`, the owner-only aggregate product-usage view (HEL-1211).

Holds: `AdminUsageRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — the route
is a thin Pekko HTTP `Directives` shell. The owner gate lives in
`services/auth/AdminAccessService`; the aggregation in
`services/telemetry/AdminUsageService`.
