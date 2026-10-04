## Why

HEL-989 blocks `DELETE /api/data-sources/:id` only when a pipeline *roots* on the source. A source can also be
referenced from JSON config with no FK: a join/lookup/union `secondaryInput` of kind `source`, an upsert step's
`existingSource` target, and a form panel's `dataSourceId` binding. Deleting such a source succeeds and leaves a
dangling reference that only surfaces later as a run/analyze or form-submit failure. Separately, workspace tag
teardown looks for dependent pipelines under RLS, so a referencing pipeline the caller cannot see is invisible to the
guard and the teardown proceeds into it.

## What Changes

- The data-source delete guard counts **every** reference kind (enumerated from code in design.md), not only roots.
- The 409 body keeps HEL-989's fields and adds, additively: a per-pipeline list of reference kinds and a `panels`
  array of visible referencing form panels. Hidden references are counted, never named.
- Teardown's dependent check becomes RLS-independent (explicit visibility predicates on the privileged pool, as
  HEL-989 does for delete) and covers the same reference kinds, exempting references that the same teardown deletes.
- The frontend conflict notice names visible panels (linking to their dashboard) and stops saying "root" for
  non-root references; the MCP `delete_data_source` description is updated to match.

## Capabilities

### New Capabilities

### Modified Capabilities

- `datasource-edit-delete`: the delete 409 covers all config reference kinds; additive body fields; UI notice.
- `workspace-tag-teardown`: the out-of-batch dependent check sees references the caller cannot see and covers all
  reference kinds, without naming hidden resources.

## Impact

- Backend: data-source reference lookup (new repository), `DataSourceService.delete`, `WorkspaceTeardownRepository`,
  delete-conflict protocol. Callers of `DataSourceService.delete` (patch-set apply/rollback/undo, first-run and
  pipeline-proposal rollback) see 409 in more cases and must still roll back cleanly.
- Frontend: `sourcesSlice` conflict parsing, `SourceDeleteConflictNotice`.
- helio-mcp: `delete_data_source` tool description.
- No migration planned.

## Non-goals

- Guarding deletes of other resource kinds (pipelines, outputs, dashboards).
- Repairing references that already dangle in existing data.
- Historical records that mention a source id (patch-set snapshots, proposals, audit events, visit history).
- Closing the check-then-delete TOCTOU window HEL-989 accepted; it is narrowed, not closed.
