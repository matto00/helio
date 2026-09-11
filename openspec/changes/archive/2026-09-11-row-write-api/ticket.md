# HEL-1077: Row write API: append and replace

## Description

`POST /api/data-sources/:id/rows` (append) and `PUT /api/data-sources/:id/rows` (replace). Both validate against the declared schema and go through the existing resource ACL — a writer must be able to edit the source.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- Append adds without disturbing existing rows.
- Replace swaps the full set atomically.
- An unauthorized caller gets the same response shape as every other resource (see HEL-1002 on not leaking existence).

## Additional context (from driver brief, verified against main and to be reconciled with the design spec during Planning)

- Reuse `DatasetRowValidator` (HEL-1076) for schema validation — do not write a second validator.
- `seq` assignment under concurrent appends must have no lost rows and no duplicate seq (HEL-1078 depends on this); needs a real concurrent test.
- Replace must be atomic in one transaction: a validation failure on row N must leave the old set intact.
- Response shape must give HEL-1078 (row id + updatedAt for preconditions) and HEL-1080 (grid) what they need.
- Enforce request size / row-count limits — find and reuse existing backend body-size/input-budget config.
- Reject non-dataset (csv/sql/rest) sources cleanly.
- Do NOT auto-run pipelines/outputs on row write (HEL-1091's epic territory) — verify nothing assumes this and don't add it.
- Rate limiting (`RATE_LIMIT_*`) and PAT auth must cover the new routes like their siblings.
- Keep `schemas/`, `openspec/` OpenAPI, and frontend service types in the same change.
- spray-json omits `Option=None` on the wire — normalize at the boundary; test with fields absent.
- RLS: `dataset_rows` writes go through the app role under forced RLS (V106). Exercise persistence under a non-superuser role; confirm ACL is enforced in the service regardless of pool privilege, and confirm whether writes go through the RLS-bypassing privileged pool (HEL-373 precedent — `listRows` once did).
- Migration V107 is next free (verified against origin/main at Setup) — only needed if new constraints/indexes (e.g. unique (data_source_id, seq)) are added.
