# Persistence — Workspace

Workspace-wide teardown/cleanup queries spanning multiple domains' tables.

Holds: `WorkspaceTeardownRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/workspace/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
