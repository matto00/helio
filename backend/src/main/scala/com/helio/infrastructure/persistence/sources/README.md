# Persistence — Sources

Data-source and image-upload persistence.

Holds: `DataSourceRepository`, `ImageUploadRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/sources/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
