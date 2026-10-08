# Services — Dashboards

Dashboard CRUD, validation and the dashboards-local read helpers (`DashboardContentsService`).

Holds: `DashboardContentsService`, `DashboardService`, `DashboardServiceValidation`, `DashboardLayoutRepair` (the pure
decision logic of the owner-only stored-layout repair, `POST /api/dashboards/:id/layout/repair`, HEL-1233).
The write bodies behind `DashboardService` (HEL-1234; ACL/`Forbidden`/404 preambles and audit calls stay in
`DashboardService`): `DashboardWrites` (create/update), `DashboardLayoutRepairWrite` (the repair's post-ownership tail),
`DashboardSnapshotImport` (snapshot import + per-panel validation).

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/dashboards/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
