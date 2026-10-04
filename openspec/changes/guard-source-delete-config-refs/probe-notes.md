# HEL-1252 probe notes

## 1.1 Reference inventory (re-derived from code, not from design.md)

Commands (from `backend/src/main`):

- `grep -rniE "references data_sources" resources/db/migration` -> only V22 (`pipelines.source_data_source_id`, dropped V98),
  V106 (`dataset_rows.data_source_id`, own content, cascades), V98 (`pipeline_roots.data_source_id`, R1), V4
  (`data_types.source_id`, table dropped V94). No other FK to `data_sources`.
- `grep -rnE "ataSourceId|SourceId" scala/com/helio/domain/steps scala/com/helio/domain/model` -> step configs carrying
  a source id: `JoinStep`, `LookupStep`, `UnionStep` (via `SecondaryInput`), `UpsertSourceConfig` (`UpsertTarget`). No
  other step config (aggregate/compute/analyze/generate/convert/...) names a source.
- `grep -rn "dataSourceId" domain/panels` -> only `FormPanel` (`panels.form_config->>'dataSourceId'`). No other panel
  kind or table stores a source id.
- Persistence-layer grep for `dataSourceId|DataSourceId`: pipelines/{PipelineRootRepository,PipelineRepository,
  PipelineCycleGuard,PipelineStepRepository}, sources/DataSourceRepository -- all roots/steps/the source's own table.

Result: D1's table (R1 root, R2 join/lookup/union secondaryInput, R3 upsertTarget, R4 form panel) is complete; no
additional live kind found. `pipeline_steps.op` values carrying a reference: join, lookup, union, upsertsource.

## 1.2 Pre-fix teardown probe (spec `DataSourceReferenceGuardNonSuperuserSpec`, teardown block, before any fix)

Command: `cd backend && nice -n 19 sbt "testOnly com.helio.infrastructure.persistence.sources.DataSourceReferenceGuardNonSuperuserSpec"`

Non-superuser app pool (helio_migration_test, FORCE RLS applies), hidden foreign pipeline:

```
6.3a join secondary input  FAILED  outcome=TeardownOutcome(false,Vector(),true,1,0,...): false was not equal to true   -> COMMITTED silently
6.3b multi-root            FAILED  outcome=TeardownOutcome(false,Vector(),true,1,0,...): false was not equal to true   -> COMMITTED silently
6.3c sole root             FAILED  PSQLException: ERROR: HEL-913: this delete would leave pipeline(s) [..] with zero roots (R1 violation)  -> V99/V100 P0001, pid in text
6.3d dry run (lookup)      FAILED  false was not equal to true   (dry run reported clean)
6.3e upsert target         FAILED  false was not equal to true
6.3f hidden form panel     FAILED  false was not equal to true
```

Superuser (BYPASSRLS, the dev/CI shape) pool, hidden multi-root pipeline -- the check BLOCKS but NAMES the hidden resource:

```
6.4d FAILED outcome=TeardownOutcome(true,Vector(TeardownConflict(data_source,139c1603-...,ref-target,has a dependent pipeline
     'STRANGER-SUPER-PIPELINE' (99bebe41-0bc6-4b44-8be0-6bfb4e54a9c5) that is not in this tag batch)),false,0,0,Vector(),0)
     ... included substring "99bebe41-0bc6-4b44-8be0-6bfb4e54a9c5"
```

So pre-fix: superuser masks the defect as a *leak* (names a foreign pipeline), the real RLS role masks it as a *miss*
(commit, or P0001 text carrying the pipeline id). The two shapes diverge, which is exactly why a superuser-only test
proves nothing here.

## Post-fix greens (same spec, fixed code)

`sbt "testOnly com.helio.infrastructure.persistence.sources.DataSourceReferenceGuardNonSuperuserSpec com.helio.infrastructure.persistence.V100ZeroRootGuardNonSuperuserSpec"`
-> 26 / 26 tests green in the new spec (teardown 6.3a-f, 6.4a-g, delete 6.2a-f x6 kinds, C2 log capture 6.6a/b),
V100 spec (3.7c-f against `findReferences`) green.

## 6.6 Mutations (each applied to main code only, spec run, then restored from backup; runner `mut.py`/`runmut.sh`)

Command per mutation: `sbt "testOnly com.helio.infrastructure.persistence.sources.DataSourceReferenceGuardNonSuperuserSpec"`.
Note the hidden SOLE-root cases (6.3c, 6.6a) stay green under a dropped root matcher: the V99/V100 trigger is a
backstop there, which is why the multi-root cases (6.3b, 6.2a root) are the root matcher's red.

```
=== MUTATION M1-drop-root-matcher
[info] - should 6.3b block, unnamed, when a HIDDEN pipeline has the tagged source as one of SEVERAL roots *** FAILED ***
[info] - should 6.4f the in-transaction narrowing check names no pipeline (pool-independent non-leakage) *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN root reference exists, leaving the file *** FAILED ***
[info] - should 6.2b name VISIBLE references with their kinds: owned pipeline (root + join), granted pipeline, owned and granted form panel *** FAILED ***
[info] Tests: succeeded 21, failed 4, canceled 0, ignored 0, pending 0
=== MUTATION M2-drop-secondaryInput-matcher
[info] - should 6.3a block, unnamed, when a HIDDEN pipeline joins the tagged source (secondary input) *** FAILED ***
[info] - should 6.3d dry run reports the same hidden-reference block a real call would hit *** FAILED ***
[info] - should 6.4a name a VISIBLE out-of-batch referencing pipeline and form panel *** FAILED ***
[info] - should 6.4c another user's identically T-tagged referencing pipeline still blocks, and is neither deleted nor counted *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN join reference exists, leaving the file *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN lookup reference exists, leaving the file *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN union reference exists, leaving the file *** FAILED ***
[info] - should 6.2b name VISIBLE references with their kinds: owned pipeline (root + join), granted pipeline, owned and granted form panel *** FAILED ***
[info] - should 6.2c C1: a pipeline shared with a THIRD user, and a dashboard shared with a third user AND publicly, stay unnamed *** FAILED ***
[info] - should 6.2e a disabled step still blocks *** FAILED ***
[info] Tests: succeeded 15, failed 10, canceled 0, ignored 0, pending 0
=== MUTATION M3-drop-upsert-matcher
[info] - should 6.3e block, unnamed, when a HIDDEN pipeline's upsert step targets the tagged source *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN upsertsource reference exists, leaving the file *** FAILED ***
[info] - should 6.2b name VISIBLE references with their kinds: owned pipeline (root + join), granted pipeline, owned and granted form panel *** FAILED ***
[info] Tests: succeeded 22, failed 3, canceled 0, ignored 0, pending 0
=== MUTATION M4-drop-form-panel-matcher
[info] - should 6.3f block, unnamed, when a HIDDEN form panel (foreign dashboard) is bound to the tagged source *** FAILED ***
[info] - should 6.4a name a VISIBLE out-of-batch referencing pipeline and form panel *** FAILED ***
[info] - should 6.4e a form panel on an untagged dashboard blocks; the dashboard shared WITH the caller is named *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN form reference exists, leaving the file *** FAILED ***
[info] - should 6.2b name VISIBLE references with their kinds: owned pipeline (root + join), granted pipeline, owned and granted form panel *** FAILED ***
[info] - should 6.2c C1: a pipeline shared with a THIRD user, and a dashboard shared with a third user AND publicly, stay unnamed *** FAILED ***
[info] Tests: succeeded 19, failed 6, canceled 0, ignored 0, pending 0
=== MUTATION M5a-pipeline-visibility-true
[info] - should 6.3a block, unnamed, when a HIDDEN pipeline joins the tagged source (secondary input) *** FAILED ***
[info] - should 6.3b block, unnamed, when a HIDDEN pipeline has the tagged source as one of SEVERAL roots *** FAILED ***
[info] - should 6.3c block, unnamed, when a HIDDEN pipeline is SOLELY rooted on the tagged source (pre-fix: V99/V100 P0001) *** FAILED ***
[info] - should 6.3d dry run reports the same hidden-reference block a real call would hit *** FAILED ***
[info] - should 6.3e block, unnamed, when a HIDDEN pipeline's upsert step targets the tagged source *** FAILED ***
[info] - should 6.4d name no hidden id or name (pre-fix the superuser connection SEES and names the hidden root pipeline) *** FAILED ***
[info] - should 6.4c another user's identically T-tagged referencing pipeline still blocks, and is neither deleted nor counted *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN root reference exists, leaving the file *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN join reference exists, leaving the file *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN lookup reference exists, leaving the file *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN union reference exists, leaving the file *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN upsertsource reference exists, leaving the file *** FAILED ***
[info] - should 6.2c C1: a pipeline shared with a THIRD user, and a dashboard shared with a third user AND publicly, stay unnamed *** FAILED ***
[info] - should 6.2d count hidden RESOURCES, not reference edges: a hidden pipeline holding root + join counts once *** FAILED ***
[info] Tests: succeeded 11, failed 14, canceled 0, ignored 0, pending 0
=== MUTATION M5b-dashboard-visibility-true
[info] - should 6.3f block, unnamed, when a HIDDEN form panel (foreign dashboard) is bound to the tagged source *** FAILED ***
[info] - should 6.2a refuse with an UNNAMED 409 when a HIDDEN form reference exists, leaving the file *** FAILED ***
[info] - should 6.2c C1: a pipeline shared with a THIRD user, and a dashboard shared with a third user AND publicly, stay unnamed *** FAILED ***
[info] Tests: succeeded 22, failed 3, canceled 0, ignored 0, pending 0
=== MUTATION M6a-pipeline-drop-grantee
[info] - should 6.2c C1: a pipeline shared with a THIRD user, and a dashboard shared with a third user AND publicly, stay unnamed *** FAILED ***
[info] Tests: succeeded 24, failed 1, canceled 0, ignored 0, pending 0
=== MUTATION M6b-dashboard-drop-grantee
[info] - should 6.2c C1: a pipeline shared with a THIRD user, and a dashboard shared with a third user AND publicly, stay unnamed *** FAILED ***
[info] Tests: succeeded 24, failed 1, canceled 0, ignored 0, pending 0
=== MUTATION M7-teardown-exempt-by-tag-only
[info] Tests: succeeded 25, failed 0, canceled 0, ignored 0, pending 0
=== MUTATION M8-log-passes-exception
[info] - should 6.6a DataSourceService.delete: warn+ log names the source id and SQLSTATE only, never the hidden pipeline *** FAILED ***
[info] Tests: succeeded 24, failed 1, canceled 0, ignored 0, pending 0
=== MUTATION M9-teardown-names-hidden-race-ex
[info] - should 6.6b teardown: a P0001 from its own DELETE blocks, with no hidden id in the body or a warn+ log *** FAILED ***
[info] Tests: succeeded 24, failed 1, canceled 0, ignored 0, pending 0
=== DONE (restored)

Second round (added 6.4g after M7 initially survived, because a hidden foreign pipeline blocks anyway; the discriminating fixture is a VISIBLE foreign T-tagged one):
=== MUTATION M7-teardown-exempt-by-tag-only
[info] - should 6.4g a foreign T-tagged pipeline and T-tagged dashboard that are VISIBLE (granted to the caller) still block, named, never deleted *** FAILED ***
[info] Tests: succeeded 25, failed 1, canceled 0, ignored 0, pending 0
=== MUTATION M7b-teardown-exempt-dashboard-by-tag-only
[info] - should 6.4g a foreign T-tagged pipeline and T-tagged dashboard that are VISIBLE (granted to the caller) still block, named, never deleted *** FAILED ***
[info] Tests: succeeded 25, failed 1, canceled 0, ignored 0, pending 0
=== DONE (restored)
```

Mutation key: M1 root matcher dropped; M2 secondaryInput matcher dropped; M3 upsert matcher dropped; M4 form-panel
matcher dropped; M5a/M5b pipeline/dashboard visibility predicate -> `true`; M6a/M6b `grantee_id = viewer` dropped
(C1); M7/M7b teardown exemption by tag only (owner dropped) for pipelines/dashboards; M8 `ex` passed to the delete
race-path `log.warn` (C2); M9 `ex` passed to teardown's P0001 `log.warn` (C2). Every one turned a named test red.
(The M5a..M9 lines above are run output; `M3`'s and `M4`'s failures are listed under their headers.)

## 6.5 / D5 caller audit

`DataSourceService.delete` callers: `PatchSetApplyForward` (a user-requested `dataSource delete` edit: a 409 now
surfaces as the same Conflict ServiceError; no rollback implied), `PatchSetApplyRollback` and `PatchSetUndoService`
(compensate/undo in REVERSE edit order, so anything created after the source -- panels, steps -- is removed first;
and a patch-set `create` cannot reference the not-yet-existing new source id, so it cannot create such a reference
to its own source), `PipelineProposalService.rollback` / `rollbackSourceOnly` (delete the pipeline FIRST, cascading
its steps and roots, then the inline sources) and `FirstRunDashboardService` (deletes only sources it created, after
its pipeline is rolled back; first-run builds only output panels, never form panels). No caller needs reordering;
a refused cleanup is already logged and tolerated by each caller (warn, no throw). Existing rollback specs
(PipelineProposalServiceSpec, PatchSetApplyServiceSpec, FirstRun specs) run in the full gate below.

## Cycle 2: test 6.4f (in-transaction check) mutation

6.4f now overrides `dependentConflicts` (pre-check skipped) on a superuser (BYPASSRLS) `WorkspaceTeardownRepository`, with a
hidden multi-root foreign pipeline (so V99/V100 never fires); the in-tx query is the only thing that can block.
Mutation M10: `sourceDependentPipelineConflict` reverted to `SELECT p.id, p.name` and a reason naming them -> RED:

```
[info] - should 6.4f the IN-TRANSACTION narrowing check blocks identity-free on a BYPASSRLS connection (which sees hidden pipelines) *** FAILED ***
[info]   outcome=TeardownOutcome(true,Vector(TeardownConflict(data_source,b2e40f85-...,ref-target,has a dependent pipeline 'STRANGER-INTX-PIPELINE' (cd8c5979-...) that is not in this tag batch)),false,0,0,Vector(),0)
[info] Tests: succeeded 25, failed 1
```
Restored; unmutated: 26/26 green.

Route 409 bodies are validated against the `schemas/sources/data-source-delete-conflict-*` schemas via `JsonSchemaValidation`; the top-level
schema `$ref`s by `$id` (host `helio.local`, unresolvable offline: UnknownHostException), so entries are validated against their own
schemas and the top-level key set is pinned.
