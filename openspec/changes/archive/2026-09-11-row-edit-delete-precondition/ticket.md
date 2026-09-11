# HEL-1078: Row edit and delete API with an `updatedAt` precondition

## Description

`PATCH` and `DELETE` per row. Concurrency is last-write-wins, but an edit carries the row's last-read `updatedAt` and is rejected if the row changed underneath.

## Acceptance Criteria

- Two concurrent appends both land (verify HEL-1077 already guarantees this; prove with a real concurrent test, not sequential calls).
- A stale-precondition edit is rejected rather than silently overwriting.
- `PATCH` and `DELETE` reuse HEL-1077's validator/ACL/limits — no forked logic.
- Cross-owner edit/delete fails under real (non-superuser, non-BYPASSRLS) RLS.

## Context

- Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)
- Related: HEL-1077 (Row write API: append and replace) — merged, `39576df8`
- Blocked by (already resolved): HEL-1075 (dataset row storage decision) — merged, `d3fb00a6`
- `dataset_rows` schema: V106 (HEL-1074), `DatasetRowValidator`/`DatasetFieldDeclaration` (HEL-1076)
