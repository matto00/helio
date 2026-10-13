## Context
See proposal.md - Why. Paths are relative to `backend/src/main/scala/com/helio/` unless stated. HEL-1485 established
"panel rows by id, then dashboards by id" for `DashboardRepository.delete` and teardown via
`DashboardRepository.lockPanelRows` (`DashboardRepository.scala:217`). V122's AFTER DELETE statement trigger on `panels`
locks affected dashboards by id, then strips layout items; V127 bumps `layout_version` on any layout change. FK
cascades: `panels.output_id -> outputs` (V94:344), `outputs.pipeline_id`/`node_step_id` (V94:208-209), `outputs.root_id`
(V98:145), `pipeline_steps.root_id` (V98:119), `pipeline_roots -> pipelines/data_sources` (V98:80-81). Multi-panel
writers today (verified at planning):

| W | Writer | Pool | Order today |
|---|---|---|---|
| W1 | `DashboardContentsOps.replaceContents` | system | DELETE by dashboard_id (scan); dashboard read unlocked |
| W2 | `PanelMutationRepository.batchUpdate` (:88) | system | per-item UPDATE, request order |
| W3 | `OutputService.delete` (:238): `deleteByOutputIdInternal`, then `OutputRepository.deleteInternal` (:303) | system | two txns; scan order; 2nd cascades unlocked |
| W4 | `PipelineRepository.delete` (:485) | user (RLS) | FK cascade |
| W5 | `PipelineStepRepository.deleteInternal` (:1000) | system | two cascading DELETEs (tail subtrees, then step) |
| W6 | `PipelineRootWrites.removeRoot` (:162) | user (may be editor grantee) | cascading step + root DELETEs |
| W7 | `DataSourceRepository.delete` (:263) | user | cascade via roots (TOCTOU window past the reference pre-check) |
| W8 | `WorkspaceTeardownRepository` (:148-167) | user | pre-locks tagged dashboards only, then pipeline/source cascades |

Multi-statement writers (W5, W6, W8) invert even with one shared dashboard: statement 1's V122 firing locks the
dashboard, statement 2 then locks more panels. Under RLS a user's `FOR UPDATE` cannot see panels on another user's
dashboard bound to their shared pipeline's output (V36 panel policies), yet RI cascades delete them.

## Goals / Non-Goals
**Goals:** one panel lock order for W1-W8; HEL-1526; cumulative preview; the split; item 5 test tightening.
**Non-Goals:** proposal.md - Non-goals. Single-panel writers (`PanelRepository.delete`/`updateTitle`/`updateAppearance`/
`replace`, `insertPlaced`/`insertBatchPlaced`/`duplicate`) comply already: at most one existing panel row and nothing
acquired after it, or dashboard lock then NEW rows only.

## Decisions
**D1 - One SECURITY DEFINER lock function in a new migration (max-on-origin/main + 1, C4).**
`hel1498_lock_panels(p_dashboard_ids, p_output_ids, p_pipeline_ids, p_step_ids, p_root_ids, p_data_source_ids text[])
RETURNS void`, `SET search_path = pg_catalog, public`, `SET row_security = off`, one `PERFORM 1 FROM panels p WHERE
<dashboard_id in ...> OR output_id IN (<outputs of those outputs/pipelines/steps/roots/sources, recursing steps from
roots>) ORDER BY p.id FOR UPDATE OF p`. Re-owned to `helio_privileged` with V100/V122's exact bracket; explicit grants
(`SELECT, UPDATE ON panels`, `SELECT ON outputs, pipeline_steps, pipeline_roots`); `REVOKE ALL ON FUNCTION ... FROM
PUBLIC` and `GRANT EXECUTE` to the migrating (app) role, i.e. `CURRENT_USER` (never a literal role: the embedded test
role is `helio_migration_test`), before the re-own. Returns void, so it discloses nothing. Alternatives rejected:
app-level `FOR UPDATE` (can't see RLS-hidden panels: W4/W6/W7/W8); moving writers to the privileged pool (teardown and
pipeline delete keep RLS deliberately); BEFORE triggers (no transition table for statement triggers; row triggers give
no global order). **Version (constraint C4):** Flyway runs with `outOfOrder=false` and `validateOnMigrate=true`, so a
gap is dangerous: if this lane shipped V129 while HEL-1434's local V128 (`V128__stored_object_deletions.sql`, unpushed)
later merged, prod would refuse to boot on the resolved-but-unapplied V128 while CI on a fresh DB stayed green. So the
migration takes exactly (max version on origin/main) + 1 -- V128 at planning time -- re-checked immediately before the
delivery push and by the auditor before merge. A clash with another lane then fails loudly as a duplicate version (CI
and Flyway both reject it) and the second lane renumbers. Never edit V1-V127.

**D2 - One Scala entry point, one call per transaction, first write.** `PanelRowLocks.lockForDeletion(dashboards,
outputs, pipelines, steps, roots, dataSources): DBIO[Unit]` (`infrastructure/persistence/panels/`), via `sql"SELECT
hel1498_lock_panels(...)".as[...]` (a `sqlu` on a SELECT throws in pgjdbc), reusing/hoisting the text-array
`SetParameter` from `pipelines/HistoryThinBatching.scala:42`. Invariant documented on the helper: exactly one id-ordered
lock statement per transaction, before anything else that locks or writes; two ordered statements in sequence are not
globally ordered; locking a superset is safe; `FOR UPDATE` skips rows a racer deleted and committed.
`DashboardRepository.lockPanelRows` is replaced by (or delegates to) this helper so there is one mechanism. Wiring: W1
dashboards=[d]; W2 batchUpdate gets an app-level `sortBy(_.id).forUpdate` over its ids (system pool, existing rows only,
no deletion: the function is not needed); W3 becomes ONE system transaction,
`OutputRepository.deleteWithPanelsInternal(id)`: lock(outputs=[o]), then `DELETE FROM panels WHERE output_id = ?
RETURNING id` (the ids actually removed; the lock function itself returns void), then the output DELETE;
`OutputService.delete` calls it after its ownership check and `deleteByOutputIdInternal` is removed if it has no other
caller; W4 pipelines=[p] (after the existing ownership/ACL check, never before); W5 steps = tail descendants + the step
(not the promoted head child), before the first write at :1020; W6 roots=[r]; W7 dataSources=[s] (after the ownership
check); W8 one call with tagged dashboards, pipelines and sources, replacing `lockPanelRows` at
`WorkspaceTeardownRepository.scala:166` (ticket item 2) and updating the :159-165 comment. `DashboardRepository.delete`
uses dashboards=[d]. Dead deleters with no main caller (`PipelineStepRepository.delete` :311,
`PipelineRootRepository.remove` :147, `OutputRepository.deleteByNodeInternal` :309) are removed.

**D3 - HEL-1526: required layout, lock, write only the computed layout, return the stored row.** The sole caller passes
`Some(layout)` (`DashboardContentsService.scala:98`); the `None` write-back branch is dead and also resurrects V122-
stripped ghost items. HEL-1526's only live exposure is therefore a dashboard that starts with ZERO panels: its DELETE
removes nothing, so V122 never locks the dashboard; the window runs from the unlocked read to replace's first
dashboard-row lock (the first INSERT's dashboard_id FK check, which fires before the output_id check), and a panel
created in it keeps its row but loses its layout item (with one or more panels, V122's dashboard lock already serializes
a concurrent create). `replaceContents(dashboardId, newPanels, layout: DashboardLayout)`: (1) panel lock (D2), (2)
dashboard `FOR UPDATE` existence read (`None` -> `None`), (3) DELETE panels, (4) INSERT, (5) UPDATE layout/last_updated,
(6) re-read the row and return it, so the response's `layoutVersion` is current. Replace-all stays last-writer-wins (D4
of HEL-363); CAS/409 rejected because the written layout is authoritative for the new panel set, not a merge.

**D4 - Cumulative preview via an immutable overlay.** New `services/patchsets/PatchSetPreviewOverlay.scala`: projected
current state per updated target (panels, dashboards incl. layout + layoutVersion, dataSources, pipelines, steps,
outputs), `removed: Set[(kind, id)]` (direct and cascaded), `createdPanels: Map[DashboardId, Int]`.
`PatchSetPreviewService.previewResolved` threads it; `project(edit, user, ctx, overlay)` returns the preview plus the
extended overlay (a 3-arg overload with `PreviewOverlay.empty` keeps existing callers). Read rule: a target or reference
in `removed` -> whole-call `Left(NotFound)` (step-create parent -> `UnprocessableEntity`, matching `StepPlacement`);
otherwise compute `after` from `overlay.current(prior)`. Extend rule: update stores the projected object; panel create
appends a placement keyed by a per-edit placeholder id `(pending:<editIndex>)` (so two creates in one set stay distinct;
parity specs normalize created ids) with `CreatePlacement.append` and sizes from a pure helper extracted out of
`PanelBindingChecks.defaultSizesFor` (shared by apply and preview), version +1; panel/output/step/pipeline/dashboard
delete records removals (step delete mirrors `deleteInternal`'s splice: tail subtrees removed, head child promoted) and
strips removed panels' items V122-style (version +1 only if the layout changed). `dashboardUpdateAfter` rejects
`expectedLayoutVersion != base.layoutVersion` with `LayoutConflict`. Dashboard-delete impact count = DB count - removed
+ created. Preview turning apply's mid-set failure into a whole-call `Left` follows the existing precedent
(`PatchSetPreviewProjection.scala:34-45`). **`before` and fingerprints stay pre-apply**: apply's `priorState`, undo
journal and stale check all use resolve-time state (`ResolvedEdit.priorStateJson`/`toOutcome`,
`PatchSetApplyTypes.scala:86-89`; journal `PatchSetApplyService.scala:202`; stale check `:92-98`); an overlay-based
fingerprint would never match apply's recomputation and would 409 any two-edit set on one target.

**D5 - Split first, its own behaviour-preserving commit.** Dispatcher `PatchSetPreviewProjection.scala` (`project`,
`computeAfter`, `PendingId` `private[patchsets]`) +
`PatchSetPreview{Panel,Dashboard,Source,Pipeline,Step}Projection.scala`; `PipelineStepProjectionSupport` stays. Drop the
unused import, refresh stale docs; existing preview specs pass unchanged. Every file (incl. the overlay and dashboard
projection) stays under ~250 lines after the overlay too.

**D6 - Tests.** Shared `LockRaceSupport` (pools, `backendPid`, `awaitLockWait`, a strict `sqlState` returning `Some` for
`PSQLException`, rethrowing anything else). `DashboardDeleteRacesPanelDeleteSpec` asserts `(None, None)`. New red-first
race specs on `VerifiedEmbeddedPostgres` via `LayoutStripDbSupport` (NOBYPASSRLS app role) for W1-W8: panels A < B
inserted B-first; a gate session holds A `FOR UPDATE` (simulating the already-correct dashboard delete paused after its
lowest id); the real writer starts; await its lock wait; the gate deletes the dashboard and commits; pre-fix 40P01,
post-fix `(None, None)` -- EXCEPT W2: post-fix its id-ordered lock skips the rows the gate deleted, so the repo
`batchUpdate` fails with exactly `NoSuchElementException("Panel '<id>' not found")`
(`PanelMutationRepository.scala:93-95`); its spec asserts gate side `None` and writer side either success or exactly
that exception, and still rethrows any other non-PSQL error. The race drives the repo method, not `PanelBatchWrites`
(which folds every failure, 40P01 included, into `Left(BadRequest)`, hiding the red). Every other writer must end
`(None, None)`. W4 and W8 use a grantee-owned dashboard so only D1 (not an app-level lock) turns them green. HEL-1526
(owner-approved test-harness gate, escalation answer `adopt-skeptic-fix`): a red-first spec on a dashboard that starts
with ZERO panels. Start order (both runs): gate first, then `replaceContents`, then the create. A gate session
(superuser/schema owner, which SHARE mode requires) holds `LOCK TABLE panels IN SHARE MODE`, which blocks
`replaceContents` at its panel DELETE (ROW EXCLUSIVE) before it takes any dashboard-row lock; a real concurrent
`insertPlaced` (app pool, owner) takes the dashboard `FOR UPDATE` and blocks on its own panel INSERT (pre-fix; post-fix
it waits on the dashboard row instead -- the per-pid await covers both); the spec waits for EACH racer's lock wait
separately (a per-pid `awaitLockWait`, not "any session waiting"; each racer runs on a one-connection pool, or a pool
with its own `ApplicationName`, so its backend pid is known), then the gate commits. Pre-fix: the create commits first,
then replace's computed layout overwrites it, leaving a panel with no layout item (red). Post-fix: replace's panel lock
/ dashboard `FOR UPDATE` serializes the two, so afterwards panel and item sets match in every breakpoint (the race spec
asserts only that, plus `(None, None)`: the create commits after replace and V127 bumps the version again, so the race
cannot check replace's returned version). A separate, non-racing spec replaces with a layout DIFFERENT from the stored
one (V127 bumps only on change, so a no-op layout would be green pre-fix) and asserts the returned `layoutVersion`
equals the stored version (red pre-fix: the response is a copy of the pre-read row). Because D3 changes
`replaceContents`'s signature, the HEL-1526 specs need a one-line call edit between the red and green runs; the PR
evidence records both runs and that edit. The gate changes test code only; production code beyond D3 is unchanged (C5).
W7's fixture uses a pipeline with two roots whose deleted root's steps have no children (V99/V100 zero-root guard;
V94:172 `parent_step_id` has no ON DELETE action). Preview: `PatchSetPreviewCumulativeSpec` (route level) compares
preview `after` with apply `resultingState` for each scenario in the delta spec, labelled `PROOF:`/`GUARD:`; the two
ghost-layout guards in `PatchSetPreviewGhostLayoutSpec.scala:73,79` get `GUARD:` prefixes and the RED/GUARD legend line.

## Risks / Trade-offs
- [Migration number race with HEL-1434] -> C4: exactly max-on-origin/main + 1, re-checked at push and by the auditor.
- [This lane's V128 (checksum differs from HEL-1434's) on the shared dev DB breaks that lane] -> C2: no `sbt run`.
- [The lock function locks a superset] -> safe; extra waits are bounded by transactions that would otherwise deadlock.
- [A panel created after the pre-lock is locked later by the cascade] -> needs a concurrent delete of that new panel;
  documented on the helper (residual HEL-1485 accepted).
- [Preview overlay drifting from apply] -> shared pure helpers (placement sizes, splice logic) and PROOF parity specs.

## Planner Notes
- HEL-1526 folded in by owner decision (`HEL-1498-1791863327533-e537a4`, `fold-in`). Self-approved: the SECURITY
  DEFINER function follows V100/V122 precedent (no new dependency or API change).
- Follow-ups (triaged at delivery): outputs-vs-dashboards inversion; preview `MatchError` on ConvertFormat/
  AnalyzeWithAi/GenerateText step updates (`PatchSetPreviewProjectionSteps.scala:19-43`); preview step-create
  re-parenting and the data-source-delete cascade.
