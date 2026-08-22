# Persistence

Slick repositories, split by domain (`persistence/<domain>/`), plus the two
shared connection-management files that stay at this root: `Database`
(HikariCP pool wiring) and `DbContext` (the `withUserContext`/
`withSystemContext` transaction wrapper every repository goes through — see
CONTRIBUTING.md's "Database transactions & RLS context").

Does NOT hold: domain data types (`domain/model/`), service-layer
orchestration or business rules (`services/<domain>/`), or non-Slick storage
(`infrastructure/storage/`). A repository exposing a per-id read must follow
the ACL triad (`findById`/`findByIdOwned`/`findByIdInternal`) documented in
CONTRIBUTING.md; that convention applies uniformly across every domain
subdirectory here, this split does not change it.
