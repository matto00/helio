# HEL-1121: Row listing API: GET dataset rows with id, seq and updatedAt (paged)

## Description

`GET /api/data-sources/:id/rows` returns a dataset's rows **with their row identity**: `id`, `seq` and `updatedAt`, which HEL-1077 truncates to µs. HEL-1080's grid needs this to send the precondition on HEL-1078's per-row `PATCH`/`DELETE`.

Today `readDatasetRows` returns only raw cells, with no `id`, `seq` or `updatedAt`. HEL-1078 deliberately left this out of scope and raised it at delivery (2026-09-11). The driver triaged it as a standalone ticket, delivered **before** HEL-1080.

## Acceptance Criteria

- **Paging:** paged by `seq`, with a stable order and a cursor or offset plus a total count; the page-size cap is enforced. A 10k-row dataset must never come back in one unbounded response.
- **Access control:** the existing resource ACL applies. An unauthorized or nonexistent source returns the same 404 shape as every other resource (HEL-1002). Verified under a **non-superuser, non-BYPASSRLS** role, and the endpoint does **not** read through the RLS-bypassing privileged pool.
- **Timestamps:** `updatedAt` round-trips byte-for-byte into HEL-1078's precondition. A test reads a row through this endpoint, then PATCHes it with that `updatedAt` and succeeds.
- **Wrong kind:** a non-dataset source kind is rejected cleanly.
- **Contract:** `schemas/`, OpenAPI and the frontend service types change in the same PR.

## Context (parent epic HEL-1072, blocks HEL-1080)

- Parent epic: HEL-1072. Project: Helio v0.8 — Interactive Data & Write-Back.
- Blocks HEL-1080 (row grid UI) — that ticket needs rows with id/seq/updatedAt to drive HEL-1078's PATCH/DELETE precondition header.
- HEL-1078 (PR #637, commit deb53526) deliberately scoped row listing out of its own delivery; its design.md lists "a row-listing GET endpoint" as a Non-Goal and names it as the spinoff this ticket is.

## Driver-supplied implementation guidance (verify against ground truth before relying on it)

- Reuse conventions from archived designs: `openspec/changes/archive/2026-09-11-row-edit-delete-precondition/` (HEL-1078), `openspec/changes/archive/2026-09-10-migration-a-dataset-rows/`, `openspec/changes/archive/2026-09-10-decide-dataset-row-storage/`.
- Existing resource ACL path + HEL-1002 not-found shape + `lockSource` conventions in `DataSourceRepository`/`DataSourceService` should be reused, not reinvented.
- `updatedAt` truncation-to-microseconds convention (HEL-1077) applies; wire format is `Instant.toString`, parsed with `Instant.parse` — there is no custom `JsonFormat[Instant]`.
- V106 migration already created `idx_dataset_rows_data_source_id ON dataset_rows(data_source_id, seq)` — check whether this is sufficient before assuming a new migration/index is needed. If a migration is determined to be necessary, the next free version is V107, but this must be raised to the human driver as an ESCALATION before creating it — do not self-approve.
- Design the response shape with HEL-1080 (the grid) as the actual consumer in mind: page size, cursor vs offset, total row count, and whether the declared schema travels alongside rows or via the existing source GET — make and record an explicit decision in design.md.

## Critical verification requirements (binding on evaluator + skeptic, both gates)

1. **RLS test**: exercise this new read path under a non-superuser, non-BYPASSRLS DB role; explicitly confirm it does NOT go through the RLS-bypassing privileged pool (`ctx.withSystemContext`) the way `readDatasetRows` currently does. See MISTAKES.md's "RLS policies never run in dev or CI" and HEL-373 precedent.
2. **Round-trip test**: GET a row via this new endpoint, PATCH it via HEL-1078's PATCH endpoint using the `updatedAt` value AS RETURNED IN THE JSON RESPONSE (not the raw DB timestamp), and confirm the PATCH succeeds.
3. **Paging stability under concurrent appends**: a seq-ordered cursor must not skip or duplicate rows when new rows are appended to the dataset mid-paging. The design must state the paging semantics that make this true, and a test must confirm it.
4. **No regression to `readDatasetRows`**: existing consumers (pipeline engine, Spark submitter, preview) must be completely unaffected — this ticket adds a new read path alongside `readDatasetRows`, never modifies its existing shape/behavior.
5. **spray-json `Option=None` omission**: fields with `None` are omitted on the wire, not emitted as `null` — schemas/tests must account for fields being absent, not just null.

## Known CI flake

`e2e/focus-presence-guard.spec.ts:163` (tracked as HEL-1119) — if a CI run's only red is exactly that spec/line, this is a suspected pre-existing flake, not this ticket's defect. Report to the driver rather than treating it as new work.
