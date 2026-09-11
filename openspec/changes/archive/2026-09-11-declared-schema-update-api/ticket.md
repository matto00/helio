# HEL-1124: Declared-schema update API: change a dataset schema after creation (and decide what happens to existing rows)

## Description

There is no API to change a dataset's declared schema after creation. Verified on `main` @ `4e313d49` (ticket originally verified at `50993f49`; line numbers shifted, substance unchanged — see persisted `premise-validation.md`): `UpdateDataSourceRequest(name: Option[String])` (`DataSourceProtocol.scala:129`) carries **only** the name, and `PATCH /api/data-sources/:id` (`DataSourceRoutes.scala:103`) passes it straight to `DataSourceService.update`. `dataset_schema` is written **once**, at create (`DataSourceService.insertDatasetSource`).

HEL-1079 (create a dataset and declare its schema) requires that "schema edits on a dataset with existing rows need an explicit answer in the UI (block, warn, or migrate)". None of those three is buildable without a write path, and the underlying question — what happens to rows already stored under the old declaration — is a data-integrity decision, not a UI one.

**Decide and implement, in this ticket:**

* **Which edits are allowed** — add an optional field, rename, retype, add a `required` field to a non-empty dataset, drop a field with data in it. State the rule per case.
* **What happens to existing rows.** Rejecting an incompatible edit and migrating rows are both defensible; silently leaving rows that no longer satisfy the declaration is not, because `DatasetRowValidator` (HEL-1076) then rejects every later write to a row set the app itself created.
* **Concurrency.** A schema edit racing a row write must not leave rows that violate the declaration. HEL-1077 has a `lockSource`/transaction pattern to reuse, and HEL-1078 an `updatedAt` precondition.

## Acceptance Criteria

* A route updates the declared schema, reusing the existing ACL and the HEL-1002 not-found shape.
* Each allowed and rejected edit is covered by a test, including an attempt against a non-empty dataset.
* Exercised under a **non-superuser, non-BYPASSRLS** role.
* Contract (`schemas/`, OpenAPI, frontend service types) in the same PR.
* Blocks HEL-1079.

## Context reused from prior tickets (verified in premise-validation.md)

* HEL-1002 ACL / not-found response shape.
* HEL-1077 `lockSource` (`DataSourceRepository.scala:355`, `FOR UPDATE`) + transaction pattern.
* HEL-1078 `updatedAt` optimistic-concurrency precondition idiom (`DataSourceService.scala:810-847`).
* HEL-1076 `DatasetFieldDeclaration`/`DatasetRowValidator` — design.md explicitly lists a mutate-declaration endpoint as a Non-Goal ("no product decision exists ... not built here") — this ticket is that follow-on.
* HEL-1122 `GET /api/data-sources/:id/schema` (shipped, `DataSourceService.getDatasetSchema`, line 891) — this ticket's new route sits alongside it.

## Decided policy (see design.md for full rationale — self-approved, not escalated: v0.8 spec is silent, but the six-case rubric below is a bounded, reversible API-shape decision, not a product/architecture call)

| Edit | Empty dataset | Non-empty dataset |
|---|---|---|
| Add optional field | allowed | allowed (rows migrated: field absent, `required=false`) |
| Add required field | allowed | allowed **only** if a `default` is supplied (rows migrated: default value backfilled into every existing row); otherwise **409 rejected** |
| Rename field | allowed | allowed (metadata-only; row data unaffected — schema is positional) |
| Retype field | allowed | allowed **only if every existing value in that column converts** under `DatasetRowValidator`'s coercion rules; else **409 rejected**, naming offending row count |
| Drop field with data | allowed | **409 rejected unless** the request passes `confirmDrop: true` — an explicit, named opt-in (never silent); then rows are migrated by dropping that column's cell from every row |
| Reorder fields | allowed | allowed (rows migrated: cell order rewritten to match) |

Every response states exactly what happened: `rowsMigrated` count, or a 409 body naming why and (for retype) which/how many rows are incompatible — so HEL-1079's UI can render block/warn/migrate honestly.
