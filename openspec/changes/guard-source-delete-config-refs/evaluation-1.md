## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `c4c64ab58a34a6bec7c32e3da28a087cbd326047` (single commit on top of base `260943222894a97e2d65447ff9b00a7e7f57df89`, resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1: I re-derived the reference inventory myself instead of trusting probe-notes. I grepped the migrations for FKs to `data_sources` and for source-id columns: V4 `data_types` (table dropped), V22 (column dropped by V98), V98 `pipeline_roots`, and V106 `dataset_rows` (the source's own content). V94 `binary_refs` is keyed by pipeline/step, not by source. In the domain, only `SecondaryInput` (join/lookup/union), `UpsertTarget` (`upsertsource`) and `FormPanelConfig.dataSourceId` carry a source id. D1 is complete, and the finder covers R1 to R4. The op string `upsertsource`, the `panels.kind = 'form'` check (V108) and the `secondaryInput`/`target` keys all match the codecs.
- AC2: the body keeps HEL-989's fields. The only additions are `pipelines[].references` and `panels[]`. A live 409 from the running backend had exactly these keys: resourceKind, resourceId, resourceName, reason, message, pipelines, panels. Hidden references show up only as "a pipeline you cannot access".
- AC3: teardown's pre-check runs on the privileged pool, and it also runs on dry runs. Only caller-owned resources tagged T are exempt (`WorkspaceTeardownRepository.scala` `dependentConflicts`). The in-transaction check no longer carries any identity.
- AC4: see Phase 2. I independently confirmed red under the real non-BYPASSRLS two-pool harness.
- AC5: the notice and the MCP `delete_data_source` description were both updated. Every MCP tool the description cites exists (`remove_root`, `delete_pipeline`, `update_pipeline_step`, `delete_pipeline_step`, `update_panel` (form `config` patch is supported server-side), `delete_panel`).
- C1 is honoured: all three visibility predicates are `owner_id = viewer OR EXISTS(resource_permissions ... grantee_id = viewer)`. A public grant or a third-party grant does not confer visibility (6.2c).
- C2 is honoured: the race-path `log.warn` lines in `DataSourceService.scala` and `WorkspaceTeardownRepository.scala` log only the source id and SQLSTATE, never `ex`. The finder's decode-failure log is debug only. `SourceReferences` carries no hidden identity by construction.
- Tasks 1.1 to 6.7 are all marked done and match the diff. There is no scope creep and no migration. The planning artifacts match the implementation.

### Phase 2: Code Review — FAIL
Gates. I ran all of these myself in WORKTREE_PATH and did not rely on the executor's report:
- `nice -n 19 sbt testFull` (backend): 5590 succeeded, 0 failed, EXIT=0, passed on the first run. `sbt --client shutdown` was run afterwards. The new `DataSourceReferenceGuardNonSuperuserSpec` (26 tests) and the updated `V100ZeroRootGuardNonSuperuserSpec` / `DataSourceRoutesSpec` are green.
- `npm run lint` passed (0 warnings). `npm run format:check` passed. `npm run typecheck` passed. `npm test` passed: helio-mcp 35 suites / 350 tests and frontend 411 suites / 4285 tests. `npm --prefix frontend run build` passed. helio-mcp `npm run typecheck` passed. `npm run check:scala-quality` exited 0, with informational size warnings only.

RLS proof check (the orchestrator asked for this specifically):
- The two pools really are distinct. The app pool is `helio_migration_test` (`NOSUPERUSER NOBYPASSRLS`, FORCE RLS applies). The privileged pool is a separate Hikari pool with `SET ROLE helio_privileged` (BYPASSRLS). A third pool, a superuser, is used only for the contrast fixtures. Fixture liveness is asserted with `appRoleSeesPipeline(...) shouldBe false`.
- Recorded reds, reproduced independently. I made a throwaway detached worktree at the reviewed SHA under the scratchpad and applied two mutations to main code only:
  - (a) Pre-check disabled (`if (false && preConflicts.nonEmpty)`), which is the pre-fix teardown shape. Under the non-BYPASSRLS pool, 6.3a (join), 6.3b (multi-root), 6.3d (dry-run lookup), 6.3e (upsert) and 6.3f (form panel) went red. 6.3c (sole root) stayed green through the P0001 backstop, exactly as probe-notes says.
  - (b) `rp.grantee_id = $viewer::uuid` dropped from all three predicates. 6.2c (C1) went red.
  - Result: 15 passed, 11 failed. The worktree was removed afterwards (`git worktree remove --force`) and `git worktree list` is clean.
- Teardown exemption is "caller-owned AND tagged". `p.ownerId.toLowerCase == caller && p.tag.contains(tag)`, and the same for the dashboard of a panel. 6.4g pins this with a visible foreign pipeline and dashboard that are tagged T.

Issues:
1. **[mechanical] CONTRIBUTING.md "Imports & Qualifiers"** ("never inline a fully-qualified name when an `import` would do"). `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceReferenceGuardNonSuperuserSpec.scala:586` uses `LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME)`. `check:scala-quality` misses it, apparently because its pattern does not match `slf4j`. It is still a violation of the written rule.
2. **Test does not prove what its name claims (D4, "Tests meaningful").** Test `6.4f the in-transaction narrowing check names no pipeline (pool-independent non-leakage)` (same file, around lines 413-423) only asserts that the *pre-check* names a *visible* pipeline (`should include(pid)`). The pre-check always blocks first, so the in-transaction query is never reached. No test in the shipped suite exercises the in-transaction conflict path. D4 depends on that conflict being identity-free on a BYPASSRLS connection, and if `sourceDependentPipelineConflict` went back to naming `p.id`/`p.name`, every test would stay green. My probe (a) above showed that path *is* currently identity-free: 6.4d on the superuser pool stays green with the pre-check disabled. But nothing guards it.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh`, and `assert-phase.sh servers` passed. Both listener processes' `/proc/<pid>/cwd` resolve inside this worktree (`.../HEL-1252/backend` on port 9591 and `.../HEL-1252/frontend` on port 6684).

Live fixtures in the dev DB, which is a BYPASSRLS superuser connection, so non-leakage cannot rely on RLS there:
- a visible join pipeline (owned by the dev user)
- a visible form panel on a dashboard owned by the dev user
- a HIDDEN lookup pipeline owned by another user

Results:
- API `DELETE`: 409 with the visible pipeline (`references: ["join"]`) and the visible panel named, and the hidden one counted as "a pipeline you cannot access". The hidden id/name appears in neither the body nor `.concertino-backend.log`.
- Teardown dry run on the source tagged `eval1252-td`: blocked, with the same naming and counting.
- UI (sidebar actions, then Delete, then Confirm): the notice shows "was not deleted" plus the server reason. It links the pipeline to `/pipelines/:id` with "(pipeline, join input)", and links the panel to `/dashboards/:dashboardId` with "(form panel on EVAL1252 Ops board)". The panel link navigates correctly.
- The notice is legible in dark and light themes:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/.playwright-mcp/hel1252-eval-notice-dark.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/.playwright-mcp/hel1252-eval-notice-light.png`
  - The light-theme capture was made by switching `data-theme` live, not with the app toggle.
- Console: the only error is the browser's network log of the expected 409. There were no app exceptions.
- Breakpoints:
  - 1440 and 1100: no overflow (scrollWidth equals clientWidth; UUIDs wrap).
  - 768: the sidebar host collapses. This layout predates the change.
- Accessibility: the entries are real `<a>` links and the notice has `role="alert"`.
- Dev-DB residue: every fixture was deleted by exact id (panel, dashboard, both pipelines, then both sources through the API). A verification count afterwards returned 0 for all of them. I left no residue.

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceReferenceGuardNonSuperuserSpec.scala:586`: add `import org.slf4j.Logger` at the top. No clash: the logback one is already aliased as `LogbackLogger`. Then write `LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)`.
2. Same file, test 6.4f: make it exercise the in-transaction conflict path it is named for. The 6.6b pattern works for this:
   - Build a `superTeardownRepo` subclass whose `dependentConflicts` override returns `(sources, Vector.empty)`.
   - Seed a HIDDEN foreign pipeline that has the tagged source as one of *several* roots, so P0001 does not fire.
   - Run the teardown on that superuser repo.
   - Assert `blocked shouldBe true`, and that `out.toString` contains neither the pipeline id nor its name.

   Record in probe-notes.md that reverting `sourceDependentPipelineConflict`'s reason to name `p.id`/`p.name` turns this test red. If you prefer to keep the current body, rename the test to what it asserts. That leaves D4's identity-free claim unguarded, so it is the weaker option.

### Non-blocking Suggestions
- The Sources table's "Used by" column (and the sidebar) still counts roots only. During review, "EVAL1252 Target" showed **Unused** while it was referenced by a join step and a form panel, then the delete was refused. This predates the change and was not in the ticket. Consider a follow-up so the column uses the same finder.
- The notice repeats the server reason, raw UUIDs included, next to the linked list. The design asks for this so the hidden count survives in mixed cases. Whether the UUID-heavy wording reads well is a judgment call for the skeptic.
- No route spec validates a 409 body against the new `schemas/sources/data-source-delete-conflict-response.schema.json`. I checked the live body's keys and enum values by hand. A schema-validation assertion in `DataSourceRoutesSpec` would prevent drift.
