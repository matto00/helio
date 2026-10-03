# HEL-989: Deleting one of several pipeline roots via DELETE /api/data-sources/:id silently drops the root and destroys panels on its Outputs

## Description
`DELETE /api/data-sources/{id}` cascades into `pipeline_roots` via `ON DELETE CASCADE`. When the deleted source is a pipeline's sole root, the V99 trigger raises and the delete fails (HEL-987, now a structured 409). When the source is one of several roots, nothing stops it: the delete succeeds, that root is silently removed from a still-valid pipeline, and panels placed on that root's Outputs are silently destroyed via the outputs -> panels cascade. The multi-root path never reaches `PipelineService.removeRoot`, so neither its guard nor its placement-count report runs.

HEL-987 shipped `sole-root-only` and declined `any-reference` as a breaking API change. This ticket owns the design ruling.

## Owner ruling (2026-10-03, binding): `any-reference`
- `DELETE /api/data-sources/:id` returns a structured 409 whenever ANY pipeline references the source as a root, naming those pipelines.
- The user removes the root in the pipeline editor first (`PipelineService.removeRoot`'s last-root guard and placement-count report apply there).
- Matches `WorkspaceTeardownRepository.sourceDependentPipelineConflict`.
- Deliberately accepts the breaking change HEL-987 declined: some multi-root source deletes that succeed today will 409.

## Acceptance criteria
- Deleting a source that is one of several pipeline roots no longer silently destroys placed panels; it blocks with a structured conflict naming the referencing pipelines.
- The design pass explicitly rules on `any-reference` (owner ruling above), enumerates every data-source delete path, and decides which references count (pipeline_roots; secondary join/lookup inputs).
- 409 body names only pipelines the caller may see (HEL-1002 semantics); no cross-tenant leak.
- Regression test: multi-root delete with a panel placed on the dropped root's Output, red on main (panel destroyed), green after (409 naming the pipeline, panels intact), mutation-failable.
- Frontend data-source delete UI shows the conflict usefully (naming pipelines, links if cheap), both themes, verified against the running app.
- helio-mcp `delete_data_source` description and error mapping updated.
