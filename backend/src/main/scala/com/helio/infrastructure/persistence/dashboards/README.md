# Persistence — Dashboards

Dashboard persistence, including the snapshot/export path and `DashboardContentsOps` (shared dashboard+panel read helpers).

Holds: `DashboardContentsOps`, `DashboardRepository`, `DashboardSnapshotRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/dashboards/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
