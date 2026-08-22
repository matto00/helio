# Services — Dashboards

Dashboard CRUD, validation and the dashboards-local read helpers (`DashboardContentsService`).

Holds: `DashboardContentsService`, `DashboardService`, `DashboardServiceValidation`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/dashboards/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
