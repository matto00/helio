# Persistence — Panels

Panel persistence: mutation, row storage and the row<->wire mapper.

Holds: `PanelMutationRepository`, `PanelRepository`, `PanelRowMapper`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/panels/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
