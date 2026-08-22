# Persistence — Patchsets

Applied-patch-set audit/undo persistence.

Holds: `PatchSetApplicationRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/patchsets/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
