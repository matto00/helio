# Persistence — Panels

Panel persistence: mutation, row storage and the row<->wire mapper.

Holds: `PanelMutationRepository`, `PanelRepository`, `PanelRowMapper`, and `PanelLayoutPlacement`
(HEL-1260: the dashboard-row lock + layout append that rides every create transaction; the lock MUST come
before the panel insert, see its header).

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/panels/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
