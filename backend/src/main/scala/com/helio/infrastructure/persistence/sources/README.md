# Persistence — Sources

Data-source and image-upload persistence.

Holds: `DataSourceRepository`, `ImageUploadRepository`, `StoredObjectDeletionRepository`.

`StoredObjectDeletionRepository` is the privileged-pool access to the `stored_object_deletions` queue (V128, V132): the
dual claim (legacy `claimed_at` lease plus new-style `not_before`/`lease_until`), the batched `classify` guard
(authoritative vs derived holders of a key), `defer`, `recordFailure` and the app-side `enqueue`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/sources/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
