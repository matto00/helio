# HEL-987: DELETE /api/data-sources/:id returns 500 instead of a structured 409 when the source is still referenced

## Description

During the helio-news cleanup pass against **production**, a `DELETE /api/data-sources/{id}` returned a bare 500 instead of a structured error:

```
· cleanup: skipped source 2bee37ab-8250-463d-87c6-1bf3f648ad8c (news-proj-helio-src-open):
  helio MCP tool delete_data_source failed: HelioApiError (status 500) for
  .../api/data-sources/2bee37ab-8250-463d-87c6-1bf3f648ad8c:
  500 Internal Server Error: Internal server error
```

Other sources in the same sweep deleted cleanly, so this is specific to that source's state, not a blanket outage.

A 500 is a server fault reachable from ordinary operation. The delete path already has a **409 conflict** contract for "something still binds to this source" — `WorkspaceTeardownRepository.sourceDependentPipelineConflict` computes exactly that shape for tag-scoped teardown. The single-resource delete route lets an underlying failure escape as an unhandled exception instead of mapping to that same 409. Any client that treats 500 as retryable will retry a request that can never succeed.

## Acceptance criteria

* Deleting a data source that is still referenced returns a **structured 409** naming the blocking resource (kind/id/name), consistent with the teardown conflict shape — not a 500.
* The root cause is confirmed by a probe first (reproduce the 500 against a source with a dependent pipeline) rather than assumed from the FK hypothesis in the ticket.
* A regression test covers the referenced-source delete path and is shown red before the fix.
* Backend logs record the underlying cause; the client-facing body stays non-leaky.

## Corrected premise (orchestrator premise validation, see .concertino/runs/HEL-987/evidence/premise-validation.md)

* The route path cited in the ticket is stale. The real file is `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` (lines 89-90), not `routes/datasources/`.
* **The ticket's FK hypothesis is probably wrong.** Both data-source FKs are `ON DELETE CASCADE` (`V22__pipelines.sql:4` `pipelines.source_data_source_id`, `V98__pipeline_roots.sql:81` `pipeline_roots.data_source_id`), so a dependent pipeline cannot produce an FK violation on this path.
* Stronger lead, still to be probe-confirmed: `V99__prevent_zero_root_pipelines.sql` installs `hel913_prevent_zero_root_pipelines_trigger`, an `AFTER DELETE ... FOR EACH STATEMENT` trigger on `pipeline_roots` that `RAISE EXCEPTION`s when a delete leaves a still-existing pipeline with zero roots. Deleting a source that is a pipeline's *sole* root cascades into exactly that state — which also explains why other sources in the same sweep deleted cleanly.
* Neither lead is a finding. **Probe first** and design against what the probe actually shows.

## Constraints

* No production database or deploy access. Reproduce locally against the dev Postgres.
* The dev Postgres is **shared across all worktrees**, and runs for HEL-983 and HEL-985 are live concurrently. Neither adds a migration. **If the fix needs a migration, escalate before writing it** rather than colliding on `flyway_schema_history`.

## Resolved scope decision (escalation answered by the product owner)

**`sole-root-only`.** The new 409 fires exactly when the delete would orphan a pipeline (the
source is that pipeline's sole root) — the case the probe confirmed. A source that is one of
several roots keeps today's behavior (delete succeeds). Do NOT broaden this to "409 whenever any
pipeline references the source": `any-reference` was explicitly considered and rejected here as a
breaking API change that deserves its own design pass.

The adjacent multi-root silent-panel-loss case is filed as **HEL-989** (Medium) and is explicitly
**out of scope for this ticket**. Do not fold it in.

## Root cause (probe-confirmed — see probe.md, do not re-derive)

`V99__prevent_zero_root_pipelines.sql`'s `hel913_prevent_zero_root_pipelines_trigger` raises a
plpgsql exception, **SQLSTATE `P0001` (`raise_exception`)** — NOT an FK violation (`23503`). The
raised message text is:

```
HEL-913: this delete would leave pipeline(s) [<ids>] with zero roots (R1 violation) -- remove the pipeline itself instead of its last root, or add another root first
```

It escapes `DataSourceService.delete` (line 561) -> `DataSourceRepository.delete` (lines 216-217,
a bare `table.filter(...).delete` with no error mapping) as a raw `PSQLException`, which
`ServiceResponse.runNoContent` does not handle -> bare 500.
