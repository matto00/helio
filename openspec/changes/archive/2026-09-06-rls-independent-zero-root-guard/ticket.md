# HEL-974: Make the zero-root guard trigger RLS-independent (V99 is vacuous with `app.current_user_id` unset)

## Description

HEL-913 (P2.3) replaced `pipelines.source_data_source_id` with a `pipeline_roots` table. That re-homed an `ON DELETE CASCADE`: under `V22` deleting a DataSource deleted **the pipeline**; under `V98` it deletes **the root**, which would leave a rootless orphan pipeline — falsifying HEL-913's contract clause R1 ("a pipeline with zero roots is not a representable state"), bypassing `removeRoot`'s last-root guard and its placement-count report, and silently deleting panels via the outputs→panels cascade.

HEL-913 closed that with `V99__prevent_zero_root_pipelines.sql` — `hel913_prevent_zero_root_pipelines`, a `SECURITY DEFINER`, `AFTER DELETE ... FOR EACH STATEMENT` trigger on `pipeline_roots` using a transition table.

**The residual gap: the trigger's own read is subject to FORCE ROW LEVEL SECURITY.** Measured by HEL-913's final-gate skeptic in a prod-shaped role configuration: with a `NOSUPERUSER NOBYPASSRLS` definer and `app.current_user_id` **unset**, the orphan is recreated silently (`pipelines=1, roots=0`). With the GUC set, it raises correctly. So the guard is vacuous in exactly the configuration it exists to protect — the same shape `V98`'s own header documents for its `RAISE EXCEPTION` guard, and the trap `V40` records.

**This is latent, not live.** The user-facing deletion path is closed independently: `DataSourceRepository.delete` runs under `withUserContext`, so the GUC is set and the trigger fires correctly there (HEL-987 maps its `P0001` to a 409 on exactly that path). What is missing is defence for any writer that reaches `pipeline_roots` without a user context — a migration, an admin script, a future privileged path, or a background job.

`search_path` **is already pinned** (`SET search_path = pg_catalog, public`), so there is no privilege-escalation shape here — this is purely about the guard's reach.

## Scope

* Make `hel913_prevent_zero_root_pipelines` enforce regardless of `app.current_user_id` — e.g. have the trigger's read bypass RLS the way `helio_can_access_pipeline` arranges its own access (V40's re-own-to-`helio_privileged` precedent), or restructure so the check does not depend on a row being visible under the caller's policy.
* Whatever the mechanism, it must hold for a `NOSUPERUSER NOBYPASSRLS` role with the GUC unset.

## Acceptance criteria

- [ ] With a `NOSUPERUSER NOBYPASSRLS` role and `app.current_user_id` **unset**, deleting a DataSource whose root is a pipeline's only root **raises** and rolls back — the exact repro that currently yields `pipelines=1, roots=0`.
- [ ] Deleting one of several roots still succeeds; deleting a whole pipeline still succeeds (no false positives).
- [ ] `FlywayNonSuperuserMigrationSpec` — or an equivalent that genuinely runs as the non-superuser role — **actually fires the trigger**. Today it never does, and HEL-913's V99 tests run as superuser.
- [ ] Mutation-proven: revert the fix, confirm the new non-superuser test goes red **for the right reason** (the guard not firing), not from an unrelated error.
- [ ] HEL-913's corrected V99 header and `tasks.md` caveat are updated to say the gap is closed, referencing this ticket.

## Owner constraints for this run

- Prove the guard is currently vacuous **before** fixing it — a test that only shows the fixed behaviour proves nothing about what was wrong.
- Any migration must be verified under a **non-superuser** connection. Verifying as superuser is the blind spot that shipped three broken deploys during the v0.7.x release.
- No production database or deploy access; no tagging or deploys. Agent-merge is off.
- The dev Postgres is exclusively available to this run.
