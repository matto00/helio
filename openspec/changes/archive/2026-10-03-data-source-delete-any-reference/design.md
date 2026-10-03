## Context

- `DataSourceService.delete` (services/sources/DataSourceService.scala ~626) runs `soleRootDependentPipelines`
  (RLS-scoped, names), then HEL-974's `soleRootDependentPipelineCountPrivileged` (count only), then
  `deleteFileF`, then `DataSourceRepository.delete`. Both predicates are `HAVING count(*)=1`. File deletion happens
  between pre-check and DB delete, so any guard MUST precede `deleteFileF`.
- Cascade: `pipeline_roots.data_source_id` ON DELETE CASCADE -> `pipeline_steps`/`outputs`/`binary_refs`
  (root_id) -> `panels.output_id`, `alert_rules`/`alert_events.target_output_id` (V94/V98). `pipelines.source_data_source_id`
  was dropped by V98. `node_snapshots.root_id` is FK-free.
- HEL-987 409: `DataSourceDeleteError(conflict: Option[DataSourceDeleteConflict], err)`, rendered by
  `DataSourceRoutes.completeDelete` as `DataSourceDeleteConflictResponse` (5 fields, jsonFormat5).
- Owner ruling: `any-reference`.

## Goals / Non-Goals

**Goals:** 409 on any pipeline-root reference, names only visible pipelines, before any destructive work; one
conflict shape for sole- and multi-root; frontend + mcp surface it.
**Non-Goals:** see proposal (JSON-config references, teardown gap, trigger changes, force flag).

## Decisions

1. **Delete paths enumerated (code audit).** Only two DELETE-statement sites exist: `DataSourceRepository.delete` and
   `WorkspaceTeardownRepository.teardown`. All of REST, MCP `delete_data_source` (via REST), `PatchSetApplyForward`
   (`DataSourceDelete`), `PatchSetApplyRollback`/`PatchSetUndoService` (undo of a created source),
   `PipelineProposalService.rollback*` and `FirstRunDashboardService` cleanup call `DataSourceService.delete`, so
   guarding the service covers them. The rollback/first-run cleanups delete sources they just created after
   deleting their pipelines first or before any root exists; executor must verify ordering so cleanup does not
   newly 409 (and a 409 there is logged, not swallowed silently if it leaves a source behind). Dataset deletion is
   the same path (a dataset is a `data_sources` row). Teardown already blocks any-reference (own predicate); it is
   unchanged. Connector delete does not delete sources. No user-delete cascade exists.
2. **What counts as a reference: `pipeline_roots` only.** `pipelines.source_data_source_id` no longer exists. Join/
   lookup/union `SecondaryInput.Source`, upsert `ExistingSource` and form-panel `dataSourceId` live in JSON config:
   no cascade, no panel destruction, runtime/analyze surfaces the broken reference. Extending to them needs
   step-config JSON scans per op kind: material scope growth, deferred to a follow-up ticket (not escalated: the
   ruling and AC concern roots/panel loss).
3. **Single privileged query, then visibility split.** New repo method `rootReferences(id, user)`:
   privileged (`withSystemContext`) `SELECT DISTINCT pipeline_id FROM pipeline_roots WHERE data_source_id = ?`
   gives the total; the visible subset is the pipelines the caller owns or holds any grant on, taken from
   `PipelineRootRepository.findReadEdgesVisibleToFuture(userId)` filtered to this source (existing, explicit
   predicate, mirrors HEL-1002 owner-or-any-grant). `hidden = total - visible`. RLS CAN hide referencing pipelines
   from the caller (source owner bound to another user's pipeline; V100 spec seeds exactly this), so naming must
   use the visibility predicate and a hidden pipeline yields a 409 with no name/id (reason says "a pipeline you
   cannot access"). This replaces `soleRootDependentPipelines` and `soleRootDependentPipelineCountPrivileged`
   (any-reference subsumes both); V100 spec cases 3.7c-e keep their assertions, 3.7f (multi-root hidden deletes)
   flips to 409.
4. **Response shape.** Reuse `DataSourceDeleteConflict`/`DataSourceDeleteConflictResponse`; add
   `pipelines: Vector[BlockingPipeline]` (additive, visible only). `reason` replaces the zero-root sentence with:
   "this source is a root of pipeline(s) 'A' (id), ... ; remove it from those pipelines in the pipeline editor
   first" (and an unnamed-count clause when hidden > 0). `message == reason` retained.
5. **Race path.** Multi-root has no DB trigger, so a root added between check and delete is a tiny TOCTOU window.
   Accepted and documented (same as HEL-987 for sole-root); the existing P0001 recover stays.
6. **Frontend.** `deleteSource` thunk preserves a 409 (`isAxiosError`, as connectorsSlice does) via `rejectValue`
   `{message, pipelines}`; the global generic-error toast is suppressed for that case; SidebarBody/
   EmptySchemaAffordance render the reason with `<Link to="/pipelines/:id">` per pipeline using existing InlineError
   banner/tokens (DESIGN.md), verified live in both themes.
7. **helio-mcp.** Rewrite `delete_data_source` description (remove stale "CASCADES" text; state 409, how to resolve);
   `guarded` already surfaces `body.message`; add a behavioural test for the 409 text.

## Risks / Trade-offs

- Breaking change (owner-accepted). Agents/scripts that deleted multi-root sources now get 409.
- `findReadEdgesVisibleToFuture` runs on the privileged pool; correctness of the visibility predicate is load-bearing,
  covered by the hidden-pipeline test.

## Planner Notes

- Self-approved: decisions 2 (roots only), 3, 4, 6 within the owner ruling.
