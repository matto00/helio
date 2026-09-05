# HEL-987 root-cause probe (orchestrator, Planning, pre-design)

## Method
Direct psql against the shared dev Postgres, inside `BEGIN ... ROLLBACK` (no state mutated),
with `app.current_user_id` set exactly as `DataSourceRepository.delete` -> `ctx.withUserContext` sets it.

## Result — the ticket's FK hypothesis is REFUTED

Deleting a data source that is a pipeline's SOLE root:

    BEGIN;
    SET LOCAL app.current_user_id = '539b393f-...';
    DELETE FROM data_sources WHERE id = '244afb1e-95f0-4eb7-a12d-870bef80cece';

    ERROR:  HEL-913: this delete would leave pipeline(s) [6ed5cef5-117b-44d4-9784-6268152bc4d9]
            with zero roots (R1 violation) -- remove the pipeline itself instead of its last
            root, or add another root first
    CONTEXT:  PL/pgSQL function hel913_prevent_zero_root_pipelines() line 11 at RAISE

This is a plpgsql `RAISE EXCEPTION` (SQLSTATE P0001 `raise_exception`) from
`V99__prevent_zero_root_pipelines.sql`, NOT a foreign-key violation (SQLSTATE 23503).
It cannot be an FK violation: both source FKs are `ON DELETE CASCADE`
(`V22__pipelines.sql:4`, `V98__pipeline_roots.sql:81`).

## Why it matches the production report
The trigger fires only when the cascade empties a STILL-EXISTING pipeline's roots — i.e. only
for a source that is some pipeline's *sole* root. Every other source deletes cleanly. That is
exactly the reported production signature ("other sources in the same sweep deleted cleanly").

## Where the 500 comes from
`DataSourceService.delete` (line 561) -> `dataSourceRepo.delete` (line 216-217) is a bare
`table.filter(...).delete` with no error mapping. The failed Future carries a raw
`PSQLException`, which escapes `ServiceResponse.runNoContent` unhandled -> bare 500.

## Design consequence (raised as an escalation, not decided here)
The trigger fires on SOLE-root only. A source that is one of SEVERAL roots deletes
successfully today, silently dropping that root (and, per V99's own header comment, silently
destroying panels placed on that root's Outputs). So "still referenced" has two possible
scopes for the 409. See escalation.
