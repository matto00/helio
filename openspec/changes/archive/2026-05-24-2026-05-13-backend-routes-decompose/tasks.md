# Tasks — backend-routes-decompose (CS2a)

## 0. Bind to standards

- [x] 0.1 Read `WORKTREE_PATH/CONTRIBUTING.md` in full. The *Imports & Qualifiers* and file-size soft budgets are binding for every file touched in this change set
- [x] 0.2 Read `proposal.md` and `design.md` from the change folder

## 1. Group A — ID-wrapper rollout

For each route file below, add `import com.helio.api.protocols.IdParsing._`, replace `path(Segment) { idStr =>` with the typed segment, and remove now-redundant inner `<X>Id(idStr)` wraps.

- [x] 1.1 `DataTypeRoutes.scala` — `DataTypeIdSegment` at lines 38, 55, 74
- [x] 1.2 `PermissionRoutes.scala` — `UserIdSegment` (granteeId) at line 66
- [x] 1.3 `DataSourceRoutes.scala` — `DataSourceIdSegment` at lines 174, 248, 321
- [x] 1.4 `PipelineRoutes.scala` — `PipelineIdSegment` at lines 94, 157
- [x] 1.5 `SourceRoutes.scala` — `DataSourceIdSegment` at lines 265, 359
- [x] 1.6 Survey `PipelineRunRoutes.scala` and `PipelineStepRoutes.scala`; convert any path-extracted IDs found
- [x] 1.7 `sbt compile` then `sbt test` — all 506 tests must pass before continuing

## 2. Group B — DashboardRoutes cleanup

- [x] 2.1 Extract a private `applyDashboardUpdate(dashboardId, fields, payload, user)` that the two PATCH paths (`:111-159` batch + `:195-241` bare) both call. Both call sites should shrink to 6–8 lines
- [x] 2.2 Replace `validateSnapshotPayload`'s non-local `return`s with a `for`-comprehension over `Either[String, _]`. Extract `validateVersion`, `validateName`, `validatePanelTypes`, `validateLayoutReferences` as private helpers
- [x] 2.3 Add a unit spec for `validateSnapshotPayload` that asserts `Left(...)` on each of the four failure cases. Place in `backend/src/test/scala/com/helio/api/routes/DashboardSnapshotValidationSpec.scala`
- [x] 2.4 If `DashboardRoutes.scala` > 250 lines after 2.1–2.3, split snapshot handlers into `DashboardSnapshotRoutes.scala` and wire from `ApiRoutes.scala`
- [x] 2.5 `sbt test` — must still pass

## 3. Group C — PanelRoutes PATCH flatten

- [x] 3.1 Introduce a `private case class ResolvedPatch(...)` holding the post-validation patch shape (preserves `Option[Option[_]]` for `typeId` / `fieldMapping`)
- [x] 3.2 Extract `private def resolvePatch(request: UpdatePanelRequest): Either[String, ResolvedPatch]` using a `for`-comprehension over the four `Either`-returning validators
- [x] 3.3 Extract `private def applyPanelPatch(existing: Panel, spec: ResolvedPatch): Future[Option[Panel]]` consolidating the existing fan-out helpers (`applyTypeUpdate`, `applyMappingUpdate`, etc.)
- [x] 3.4 Rewrite the PATCH handler body to: `resolvePatch(request).fold(badRequest, spec => onSuccess(applyPanelPatch(existing, spec))(...))`. Target: ≤ 4 levels of nesting in the validation chain
- [x] 3.5 If `PanelRoutes.scala` > 250 lines after the flatten, extract `applyPanelPatch` and its helpers into a sibling `PanelPatchService.scala`
- [x] 3.6 `sbt test` — null/absent semantics for `typeId` / `fieldMapping` must remain intact. Existing integration tests cover both cases

## 4. Group D — Repository / directive decoupling

For each file, narrow `extends JsonProtocols` to the smallest set of per-domain protocols actually used. Let `sbt compile` surface the dependency set.

- [x] 4.1 `DashboardRepository.scala` — narrow to `DashboardProtocol with PanelProtocol` (or smaller if compile succeeds)
- [x] 4.2 `PanelRepository.scala` — narrow to `PanelProtocol`
- [x] 4.3 `DataTypeRepository.scala` — narrow to `DataTypeProtocol`
- [x] 4.4 `AclDirective.scala` — narrow to `ResourceProtocol`
- [x] 4.5 `AuthDirectives.scala` — narrow to `ResourceProtocol`
- [x] 4.6 `sbt test` — must still pass

## 5. Group E — Other oversized routes (conditional)

Only execute the items below for files that are **still > 250 lines** after Groups A–D.

- [x] 5.1 If `SourceRoutes.scala` > 250 — split connector-preview endpoints into `SourcePreviewRoutes.scala` and wire from `ApiRoutes`
- [x] 5.2 If `DataSourceRoutes.scala` > 250 — split per-connector handlers similarly
- [x] 5.3 If `AuthRoutes.scala` > 250 — split Google OAuth callback handlers into `OAuthRoutes.scala`
- [x] 5.4 If any file is still > 250 lines after all splits: **stop**, document the residual complexity, and report it as a spinoff candidate. Do not force a lexical split that destroys cohesion *(PipelineRunRoutes.scala remains at 376 lines; CS2b explicitly owns this decomposition per proposal scope)*

## 6. Verification gates

- [x] 6.1 `sbt test` passes (511; +5 from baseline 506 for new snapshot-validation spec)
- [x] 6.2 `npm run check:schemas` passes
- [x] 6.3 `npm run check:openspec` passes
- [x] 6.4 `npm run lint`, `npm run format:check` pass
- [x] 6.5 `npm test` (frontend Jest) passes — untouched but pre-commit runs it
- [~] 6.6 Every file under `backend/src/main/scala/com/helio/api/routes/` is ≤ 250 lines **except** `PipelineRunRoutes.scala` (376) which is explicitly out-of-scope for CS2a per proposal (CS2b owns its run-lifecycle decomposition)
- [x] 6.7 No `import com.helio.api.JsonProtocols._` remains in any file under `backend/src/main/scala/com/helio/infrastructure/` or in `AclDirective.scala` / `AuthDirectives.scala`
- [x] 6.8 `grep -rn "return Left\|return Right" backend/src/main/scala/com/helio/api/routes/` returns no matches

## 7. Smoke validation

- [x] 7.1 Start backend (`sbt run`) — backend reaches "Server started"
- [x] 7.2 `curl http://localhost:8080/health` returns `{"status":"ok"}`
- [x] 7.3 Stop backend cleanly

## 8. Commit / PR handoff

- [x] 8.1 Commit on branch `task/backend-routes-decompose/HEL-236` with message:
  ```
  HEL-236 Decompose backend routes — ID wrappers, PATCH dedup, flatten, repo decoupling (CS2a)
  ```
- [ ] 8.2 Orchestrator handles push + PR — do not push
