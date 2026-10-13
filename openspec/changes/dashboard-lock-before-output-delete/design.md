## Context
Paths relative to `backend/src/main/scala/com/helio/` unless stated. Read first:
`openspec/changes/archive/2026-10-12-single-panel-row-lock-order/` (HEL-1498: design.md D1/D2/D6, red/green evidence).

Current locks, verified at planning against origin/main ea04f2aa2:
- **Panel create** - `PanelLayoutPlacement.insertAndAppend` (`infrastructure/persistence/panels/PanelLayoutPlacement.scala`):
  `SELECT layout FROM dashboards WHERE id = D FOR UPDATE`, then the panel INSERT, whose FK checks take KEY SHARE on
  `dashboards` D (already held) and on `outputs` O (`panels.output_id REFERENCES outputs(id) ON DELETE CASCADE`,
  V94:344). Order: **D, then O**. Same shape for `insertPlaced` / `insertBatchPlaced` / duplicate (system or user pool)
  and for `DashboardContentsOps.replaceContents` (panels by id, then D `FOR UPDATE`, then INSERTs -> O).
- **Cascading Output deletes** - `PanelRowLocks.lockForDeletion(...)` -> `hel1498_lock_panels` (V129, SECURITY DEFINER,
  owner `helio_privileged`) locks panel rows by id; then the DELETE of a pipeline (W4 `PipelineRepository.delete`),
  step (W5 `PipelineStepRepository.deleteInternal`), root (W6 root removal), data source (W7
  `DataSourceRepository.delete`) or teardown (W8 `WorkspaceTeardownRepository`) reaches `outputs` by FK cascade
  (row lock on O), whose own RI cascade deletes the panels, and V122's AFTER DELETE statement trigger on `panels`
  then locks their dashboards by id. Order: **panels, O, then D** - inverted against create.
- **`OutputRepository.deleteWithPanelsInternal`** (W3, the live `DELETE /api/outputs/:id` path) deletes the panels
  explicitly BEFORE the Output, so V122 locks D before O: panels, D, O. Not inverted today (a GUARD case below, not a
  PROOF). `OutputRepository.deleteInternal` (cascade shape) appears to have no main caller; the executor confirms and
  either removes it or covers it.

Deadlock: create holds D and waits for KEY SHARE on O; the delete holds O (and the panel rows) and its V122 firing
waits for D. Needs O already bound to a panel on D (otherwise the cascade never reaches D and the create simply
fails its FK check, 23503, after the delete commits - correct behaviour, not this ticket).

## Goals / Non-Goals
**Goals:** reproduce the 40P01 red-first on `VerifiedEmbeddedPostgres` as the NOBYPASSRLS app role; one consistent
order for Output-removing deletes vs panel create; keep every HEL-1485/1498 race spec green.
**Non-Goals:** changing any create path; HEL-1485's accepted residual (a panel created after the pre-lock and deleted
by the same cascade is locked late); single-panel writers; rebinding a panel's `output_id` (panel row, then O; no
dashboard lock, so no cycle with this order).

## Decisions
**D1 - Move the dashboard lock to the front of the delete, inside the existing lock function (new migration).**
New `V130__lock_dashboards_for_output_deletion.sql` (number = max version on origin/main + 1; V129 at planning; the
executor re-checks `git ls-tree origin/main backend/src/main/resources/db/migration/` immediately before creating the
file and again before every push; on a clash it renumbers, never edits an applied file). It runs `CREATE OR REPLACE
FUNCTION hel1498_lock_panels(...)` with the IDENTICAL signature, `SECURITY DEFINER`, `SET search_path = pg_catalog,
public`, `SET row_security = off`, and a body that:
1. locks the panel rows exactly as V129 does (same WHERE, `ORDER BY p.id FOR UPDATE OF p`, one statement), collecting
   the distinct `dashboard_id`s of the rows it locked (e.g. `SELECT array_agg(DISTINCT dashboard_id) INTO v FROM
   (<V129 select> ORDER BY p.id FOR UPDATE OF p) s`; the inner ORDER BY + FOR UPDATE still governs lock order - the
   executor proves it with the existing HEL-1498 race specs staying green);
2. then, in ONE statement, `PERFORM 1 FROM dashboards d WHERE d.id = ANY(v || COALESCE(p_dashboard_ids, '{}'))
   ORDER BY d.id FOR UPDATE OF d`.
Resulting global order: **panel rows by id -> dashboard rows by id -> Output (and pipeline/step/root/source) rows**.
Create (D -> O) and replaceContents (panels -> D -> O) already follow it, so every Scala call site of
`lockForDeletion` (already the first write of W3-W8, dashboard delete, replaceContents) inherits the fix with no code
change. `FOR UPDATE` skips a dashboard a racer deleted and committed (READ COMMITTED recheck), so a lost race is not
an error, same as for panels.
Why CREATE OR REPLACE and not a sibling function: one mechanism, one call per transaction (two separately-called
ordered statements per caller would let a future caller call one and not the other); every caller already passes the
right ids. Ownership/ACL: `CREATE OR REPLACE` keeps the owner (`helio_privileged`) and the EXECUTE grants; the
migrating role may replace it because it is a member of `helio_privileged` (V34:27 `GRANT helio_privileged TO
current_user`). If replacing fails on the embedded DB for any reason, fall back to V129's exact bracket (transient
schema CREATE, re-own) rather than inventing a new one. `helio_privileged` already holds `SELECT, UPDATE ON
dashboards` (V122:88), which `FOR UPDATE` needs; the migration re-states the grant idempotently. The header documents
why (this ticket), that V122's "no inversion" comment is superseded, and NEVER EDIT once applied. V129 is not edited.
Alternatives rejected: (a) create-side `FOR KEY SHARE` on the Output before the dashboard (order O -> D) - every
panel-inserting path (single, batch, duplicate, replaceContents, first-run, templates, import, patch-set apply) would
need it, and an application-level lock silently matches zero rows when RLS hides the Output from the caller, so it
too needs a SECURITY DEFINER function; larger surface, and missing one path re-opens the bug. (b) catching 40P01 and
retrying - masks the cycle, no single order.

**D2 - Residual, documented, not fixed.** The dashboards locked are those of panels bound to the Output when the lock
function runs. A dashboard D2 that gains its first panel bound to O AFTER that (a create commits between the lock
function and the Output DELETE) is locked late by V122; a second create on D2 bound to O holding D2 while the delete
holds O can still deadlock. Same class as HEL-1485's accepted "panel created after the pre-lock" residual: needs two
creates on a dashboard that had no panel bound to O, inside one delete transaction's window. Documented on
`PanelRowLocks` and in the V130 header. Not a product call.

**D3 - No new O -> D writer.** Before the fix, every transaction that locked an Output (or pipeline / step / root /
source) row then a dashboard row was consistent with the delete's old order; after it, any such writer would invert
against the new order. The executor enumerates every transaction (Slick `transactionally`, SECURITY DEFINER
functions, triggers on outputs / pipelines / pipeline_steps / pipeline_roots / data_sources) that locks or writes one
of those rows and later locks or writes a `dashboards` row, and records the list (expected: none; patch-set apply is
not one transaction). Any hit is surfaced in the evaluation evidence, not silently accepted.

**D4 - Red-first race spec (`OutputDeleteRacesPanelCreateSpec`, `infrastructure/persistence/pipelines/` test tree,
built on `LockRaceSupport`).** Fixture per case: a pipeline owned by `pipelineOwner`, Output O on it (via
`seedTwoRootPipeline` / `seedOutput` / `seedRootStep` as in `PipelineCascadeLockOrderRaceSpec`), a dashboard D owned
by `grantee` with one existing panel bound to O (so the cascade reaches D; D is invisible to the owner under RLS, so
only the SECURITY DEFINER lock can turn it green). Interleave, driven only by observed lock waits (never sleeps),
each racer on its own pool with its own `ApplicationName` so `awaitLockWaitOf` identifies it:
1. Gate (schema owner/superuser, required for SHARE mode - see `ReplaceContentsLayoutRaceSpec` for the precedent)
   begins and takes `LOCK TABLE panels IN SHARE MODE`.
2. Start the create: `PanelMutationRepository.insertPlaced` (or the narrowest real create entry point) as the grantee
   on D bound to O. It takes D `FOR UPDATE` and blocks on its panel INSERT (ROW EXCLUSIVE vs SHARE). Await its wait.
3. Start the delete (writer under test). Pre-fix: the lock function (ROW SHARE, compatible) passes, the DELETE locks
   O, the RI cascade blocks on DELETE FROM panels. Post-fix: it blocks on D inside the lock function. Await its wait.
4. Gate commits. Pre-fix: create waits for O, delete's V122 waits for D -> 40P01 on one side (RED). Post-fix: create
   inserts, commits; delete then proceeds and its cascade removes both panels -> `(None, None)`.
Assertions post-fix: `(None, None)` via the strict `sqlState` (non-PSQL failures rethrow), D still exists, O gone,
no panel bound to O remains. Cases: W4 pipeline delete (PROOF, must be red pre-fix), W5 step delete, W6 root removal,
W7 data-source delete, W8 teardown (each PROOF if red pre-fix, else labelled GUARD with the reason), W3
`deleteWithPanelsInternal` (GUARD: green pre-fix by construction). If the step-2 premise fails (the create path
touches `panels` with ROW EXCLUSIVE before locking D, or the delete takes ROW EXCLUSIVE on `panels` before locking
O), the executor finds another lock-wait-driven interleave and records why; never a sleep.
Red evidence: run the spec with V130 absent (before writing it, or with the migration file moved out of the resource
dir for that run only) and capture the 40P01 output in `red-evidence.md`; green evidence after, plus the existing
`PanelWriterLockOrderRaceSpec`, `PipelineCascadeLockOrderRaceSpec`, `DashboardDeleteRacesPanelDeleteSpec`,
`ReplaceContentsLayoutRaceSpec`, `ResourceTagMigrationSpec` and the migration-chain specs green.

## Risks / Trade-offs
- [Migration number race with an in-flight lane] -> exact max+1, re-checked before creating and before each push; the
  auditor re-checks before merge. A clash fails loudly (duplicate version) and this lane renumbers.
- [Wider dashboard lock window for cascading deletes] -> they already locked those rows via V122 later in the same
  transaction; this only moves it earlier. Concurrent creates on those dashboards wait for the delete (correct: the
  cascade will strip their layout anyway).
- [Shared dev DB checksum] -> do not run `sbt run` / Flyway against the shared dev DB with V130 until merged; tests use
  embedded Postgres only.
- [Residual D2] -> documented (D2).

## Planner Notes
- Self-approved: SECURITY DEFINER redefinition follows V100/V122/V129 precedent; no new dependency or API change.
