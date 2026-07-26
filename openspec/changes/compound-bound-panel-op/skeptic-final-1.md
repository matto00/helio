## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Validate-before-first-write gate actually runs before any write.** Read
   `BoundPanelService.create` → `validate` → `validateBinding` → `resolveSourceSchema` end to end
   (`backend/src/main/scala/com/helio/services/BoundPanelService.scala:49-127`). Every call in the
   gate path is a read: `accessChecker.requireAccess` (ACL check), `dataSourceRepo.findByIdOwned`
   (confirmed read-only signature `Future[Option[DataSource]]`), `dataTypeRepo.findBySourceId`
   (confirmed read-only signature `Future[Vector[DataType]]`), and `PipelineAnalyzeService.analyze`
   (confirmed a pure `object` with zero infrastructure imports,
   `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala:1-40`). No `insert`/`create`/
   write call appears anywhere in `validate`/`validateBinding`/`resolveSourceSchema`/`projectSchema`.
   The first write is `dataSourceService.createStatic` in `resolveSource`, called only after `validate`
   resolves `Right`. Confirmed by code, not inferred from naming.

2. **Compensating-cleanup order vs. real FK cascades.** Read the migrations directly:
   `V4__data_sources_and_types.sql:12` → `data_types.source_id REFERENCES data_sources(id) ON DELETE
   SET NULL` (not cascade); `V22__pipelines.sql:4-5` → `pipelines.source_data_source_id ... ON DELETE
   CASCADE` and `pipelines.output_data_type_id ... ON DELETE CASCADE`; `V23__pipeline_steps.sql:3` →
   `pipeline_steps.pipeline_id ... ON DELETE CASCADE`. `BoundPanelService.cleanup`
   (lines 290-332) deletes rows → `dataTypeRepo.delete(outputDataTypeId)` (cascades pipeline+steps) →
   only then, for an inline source, explicitly looks up and deletes the companion DataType via
   `findBySourceId` before deleting the DataSource. This is the correct order — it never relies on the
   SET NULL cascade and never leaves an orphaned "looks like pipeline output" row. Matches design.md D5
   exactly, and the design's claimed FK behavior is accurate (not just asserted).

3. **Reused `sourceDataSourceId` never touched by cleanup.** `inlineSourceIdOf` returns `None` unless
   `isInline` is true (line 263-264); `resolveSource`'s `None` branch (existing-source reuse) passes
   `inlineSource = false` all the way through, so `cleanup`'s `inlineSourceIdOpt` is `None` and the
   source-deletion branch never executes. Confirmed by a passing test: "leave a reused
   sourceDataSourceId untouched on a steps-stage failure" (`BoundPanelRoutesSpec.scala:305-324`) and
   "clean up the pipeline on a run-stage failure ... reused source untouched" (line 326-345) — both
   assert `dataSourceRepo.findByIdOwned(reusedSourceId, userA)` is still `defined` after the failure.

4. **Cross-tenant `sourceDataSourceId` reuse → 404, not 403, and it's tested.**
   `resolveSourceSchema`'s `None` case on `dataSourceRepo.findByIdOwned` returns
   `ServiceError.NotFound` (line 118) — matches `DataSourceService`/`DataTypeService` convention. Test
   "reject a cross-tenant sourceDataSourceId with 404, not 403 — no resource created"
   (`BoundPanelRoutesSpec.scala:347-364`) seeds a DataSource owned by `userB`, calls as `userA`, and
   asserts `StatusCodes.NotFound` plus an unchanged pipeline count. I ran this test myself (see below)
   — it passes.

5. **V41 belt-and-suspenders — `dataTypeId` is always server-controlled.** `injectBinding`
   (lines 272-276) computes `base + ("dataTypeId" -> JsString(dataTypeId.value))` — Scala `Map +`
   overwrites an existing key, so any caller-supplied `panel.config.dataTypeId` is unconditionally
   replaced with the freshly created pipeline output id before `panelService.buildForCreate` is ever
   called. Confirmed by test "ignore a caller-supplied panel.config.dataTypeId ... (V41 cannot be
   bypassed)" (`BoundPanelRoutesSpec.scala:389-412`), which seeds a real companion DataType id, submits
   it as `panel.config.dataTypeId`, and asserts the bound panel's actual `dataTypeId` differs from it
   and equals the freshly created one. I ran this test myself — passes.

6. **Zero-row pipeline run treated as success.** `runPipeline` (lines 204-221) only branches on
   `Left`/`Right` of `pipelineRunService.submit`, never row count — a `Right` with zero rows proceeds
   straight to `createPanel`. Test "return 201 with a bound, empty panel when the pipeline's steps
   legitimately produce zero rows" (`BoundPanelRoutesSpec.scala:366-387`) uses a real `filter` step
   that excludes every row and asserts `201` + empty row list. I ran this test myself — passes.

7. **Scope creep.** `git diff main...HEAD | grep -iE` for batch-panel-create (HEL-370), resource
   tagging (HEL-366), auto-pack layout (HEL-367), and panel-id-key (HEL-368) content — the only hits
   are documentation mentions in `ticket.md`/`proposal.md`/`design.md`/`tasks.md` explicitly scoping
   these *out*, an unrelated `tag()` string-prefix helper in `stageError`, and an unrelated
   `UpdatePanelsBatchResponse` alias line already present in `package.scala` before this change (not
   introduced by it). No functional leakage confirmed.

8. **The evaluator's non-blocking note re: `PipelineRepository.create`'s two non-transactional
   writes.** Read `PipelineRepository.create` (lines 194-246): `dataTypeRepo.insert(newDataType, user)`
   then a separate `pipelinesTable += pipelineRow` insert, not wrapped in a DB transaction. If the
   first insert succeeded and the second failed, an empty, un-pointed-to DataType (`source_id = None`,
   which is exactly what `PanelCapabilityService` treats as "looks like a pipeline output") could be
   orphaned, and `BoundPanelService`'s own cleanup on `pipelineService.create` failure calls
   `cleanup(outputDataTypeIdOpt = None, ...)` (line 174) because it never learns that DataType's id —
   `pipelineService.create` returned `Left` with no summary to extract it from. I judge this
   **non-blocking**, same as the evaluator, because: (a) this exact two-write sequence is pre-existing,
   unmodified `PipelineRepository` code shared with the granular `POST /api/pipelines` endpoint — the
   same narrow-window risk already exists there today, HEL-364 doesn't introduce it; (b) design.md
   explicitly scopes a true cross-service DB transaction as infeasible/non-goal for this ticket; (c)
   the failure window requires a genuine mid-request DB fault between two statements milliseconds
   apart — categorically different from the "how does the ordinary happy/failure path behave" bugs
   this ticket is on the hook for. A pre-existing latent risk in composed infrastructure is not grounds
   to block a ticket that composes it read-mostly and adds its own correct cleanup for every failure
   branch it does control.

### Verification commands I ran myself (fresh, this session)

- `sbt -batch "testOnly com.helio.api.routes.BoundPanelRoutesSpec"` → 10/10 passed (all listed
  scenario names match spec.md's scenarios and tasks.md's 6.1-6.6 plus the V41 regression test).
- `sbt -batch "testOnly com.helio.services.PanelCapabilityServiceSpec"` → 6/6 passed unmodified,
  confirming the `PanelBindingSpec.evaluate` extraction (`git diff` reviewed directly — pure
  delegation, no logic change) is behavior-preserving.
- `sbt -batch test` (full backend suite) → 2091/2091 passed, 0 failed.
- `node scripts/check-schema-drift.mjs` → "schemas in sync ... panel-type enums in sync".
- `npx openspec validate compound-bound-panel-op --strict` → "Change ... is valid".
- `npm run check:scala-quality` → "clean (65 soft warning(s))" — all soft file-size warnings are
  pre-existing test-file patterns across the repo, zero hard failures, zero inline-FQN violations in
  the new files (independently spot-checked `BoundPanelService.scala`/`BoundPanelRoutes.scala`/
  `BoundPanelProtocol.scala` for inline `com.helio.`/`org.apache.pekko.`/`spray.json.` qualifiers
  outside imports — none found).
- `cd helio-mcp && npm run build` (`tsc`) → clean, no type errors, confirming
  `createBoundPanel`/`create_bound_panel` wiring type-checks against the new `BoundPanelResponse`
  type.
- `git diff main...HEAD --stat -- frontend/` → empty; confirmed no `frontend/**` files changed, so
  no DESIGN.md/UI-parity review applies to this change.

### Acceptance criteria traced

All six ticket ACs trace to real, exercised code: (1) one-call compose+bind with rows present —
`BoundPanelService` execution chain + happy-path test; (2) V41 still enforced, rejected before any
panel exists — `validate`/`validateBinding` gate + unsatisfiable-binding test; (3) failure names the
stage, no dangling panel — `stageError` + cleanup on every post-gate failure branch + steps/run-stage
cleanup tests; (4) appearance applied at creation — `createPanel` passes `request.panel.appearance`
straight into `CreatePanelRequest`, reusing `buildForCreate`'s existing appearance-resolve path
(HEL-363 precedent, unmodified); (5) ScalaTest coverage for happy path / reuse / V41 / mid-chain
failure — present and passing (10 cases, exceeds the AC's four); (6) MCP tool added — `helioApi.ts`
`createBoundPanel` + `write.ts` `create_bound_panel`, single `POST`, no client-side composition,
confirmed by reading the diff and a clean `tsc` build.

### Verdict: CONFIRM

### Non-blocking notes

- The `PipelineRepository.create` two-write non-transactional gap (item 8 above) is real but
  pre-existing and out of this ticket's explicitly-scoped non-goal (true cross-service transaction).
  Worth a follow-up ticket if it's ever observed in practice, not a blocker here.
- `BoundPanelService.scala` is 374 lines — under the 400-line CONTRIBUTING.md "propose a split"
  trigger, but close to it; no action needed now given the file is a single cohesive five-stage
  pipeline with a clear stage-per-function shape.
