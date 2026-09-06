## Why

`V99__prevent_zero_root_pipelines.sql`'s `hel913_prevent_zero_root_pipelines` trigger exists to make
"a pipeline with zero roots is not a representable state" (`pipeline-multi-root` R1) hold at the
database level, for **every** writer — including ones that do not exist yet. It does not. The
trigger is `SECURITY DEFINER` owned by the migrating role (`DB_USER`), which owns the tables and is
therefore subject to `FORCE ROW LEVEL SECURITY`. Its own `JOIN pipelines` reads through the same RLS
state it exists to police, so with `app.current_user_id` unset the JOIN sees nothing, the guard
raises nothing, and the zero-root orphan is created silently (measured: `pipelines=1, roots=0`).

This is exactly the trap `V40__fix_rls_policy_function_recursion.sql` already documents, reproduced.
It is latent rather than live only because the sole shipped deletion path
(`DataSourceRepository.delete`) runs under `withUserContext`. Any privileged writer — a migration, an
admin script, a background job, a future privileged pool path — bypasses the guard entirely.

## What Changes

- A new migration re-owns `hel913_prevent_zero_root_pipelines()` to `helio_privileged` (BYPASSRLS,
  created in V34) using V40's transient `GRANT CREATE ON SCHEMA public` / `REVOKE` bracket, so the
  trigger body's reads are no longer filtered by the caller's RLS visibility.
- A non-superuser test gate that **actually fires the trigger**: a `NOSUPERUSER NOBYPASSRLS` role
  with `app.current_user_id` unset, first demonstrating the current vacuity, then the fix, then a
  mutation check that the test goes red for the right reason when the fix is reverted.
- V99's header is left byte-untouched (Flyway checksum; owner ruling `v100-header-only`); the
  corrected narrative lives in V100's header, and HEL-913's archived `tasks.md` caveat is fixed.
- **`DataSourceService.delete`'s sole-root pre-check gains a privileged, count-only companion
  check** (owner ruling `widen-precheck-privileged-count`). Making the trigger BYPASSRLS widens
  what it can see beyond the RLS-scoped pre-check, and `deleteFileF` runs between them — so
  without this, a delete of a source bound to a pipeline the caller cannot see would destroy the
  backing file and only then be refused. Count-only, so the refusal cannot leak a cross-tenant
  pipeline id or name.

## Capabilities

### New Capabilities
- `pipeline-zero-root-db-guard`: the database-level zero-root invariant and its RLS-independence —
  what the guard must catch, and for which callers, stated as behaviour rather than as an
  implementation note buried in a migration header.

### Modified Capabilities
(none — `pipeline-multi-root` R1's service-level contract is unchanged; this change adds the
database-level enforcement guarantee that R1 assumed but never stated.)

## Impact

- `backend/src/main/resources/db/migration/` — one new migration (V100).
- `backend/src/test/scala/com/helio/infrastructure/persistence/` — new/extended non-superuser spec.
- `DataSourceRepository` (new privileged count-only check) and `DataSourceService.delete` (call it
  before `deleteFileF`) — in scope by owner ruling, see What Changes.
- `openspec/changes/archive/2026-09-04-multi-root-pipelines/tasks.md` caveat. `V99__*.sql` is NOT
  touched (settled: `v100-header-only`) — its correction lives in V100's header instead.
- No application code, no API surface, no frontend. No production database or deploy access is used.

## Non-goals

- Widening the guard to other invariants, or auditing other `SECURITY DEFINER` functions for the
  same ownership defect (a real but separate sweep).
- The cross-user grant-revocation variant noted as a spinoff candidate by HEL-913's final gate,
  beyond whatever this fix closes incidentally.
- `PipelineService.removeRoot`'s service guard.
- Re-shaping HEL-987's 409 *contract*. The only `DataSourceService` change in scope is the
  privileged count-only pre-check above, added because this fix would otherwise defeat a safety
  property HEL-987 established. This is NOT a regression fix for HEL-987 — both changes are
  individually correct; the interaction is new, created by making the trigger see more.
