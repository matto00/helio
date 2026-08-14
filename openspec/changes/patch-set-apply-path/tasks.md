## 1. Backend — HEL-403 protocol fix (design.md D6)

- [x] 1.1 In `PatchSetProtocol.scala`'s `Edit.read`, raise a `deserializationError` when
      `op == "delete"` and the wire JSON's `"patch"` key is present — mirrors the reader's existing
      `target.id` enforcement, same file, same error style. Resolves HEL-403's carried-over
      follow-up at the layer that actually has the signal (round-1 REFUTE finding 1).

## 2. Backend — protocol + schema

- [x] 2.1 Create `backend/src/main/scala/com/helio/api/protocols/PatchSetApplyProtocol.scala`:
      `EditOutcome(index: Int, status: String, newId: Option[String], priorState: Option[JsValue],
      resultingState: Option[JsValue])` (`status` ∈ `applied|rolledBack|recreated|unrecoverable`;
      `priorState` — design.md D4a, ticket.md's "emit the captured prior-state set" AC — the
      pre-mutation full state for `update`/`delete` edits, `None` for `create`; `resultingState` —
      design.md D4b, ticket.md's "resulting resource states" Scope bullet — the post-mutation full
      state for `create`/`update` edits and a `recreated` delete-rollback, `None` for a plain
      `delete` or an `unrecoverable` rollback; both serialized via each kind's EXISTING response
      format: `PanelResponse`/`DashboardResponse`/`DataSourceResponse`/`DataTypeResponse`
      `.fromDomain`, `PipelineStepResponse.fromDomain` — never a new shape. `pipeline` is the ONE
      exception (design.md D4a): building `PipelineSummaryResponse` needs the joined
      `PipelineRepository.PipelineSummary` DTO via `findSummaryById`/`findSummaryByIdShared`, a
      deliberate second read beyond D2's bare-`Pipeline` ACL read for this kind only),
      `PatchSetApplyResponse(edits: Vector[EditOutcome], failure: Option[String])`, formats.
- [x] 2.2 Create `schemas/patch-set-apply-response.schema.json` (`PatchSetApplyResponse`, matching
      2.1's case class fields exactly for `check-schema-drift.mjs`).
- [x] 2.3 Add the new protocol trait to `JsonProtocols.scala`'s `extends` list.

## 3. Backend — pre-validation

- [x] 3.1 In `PatchSetApplyService.scala`, implement the pre-validation pass (design.md D2), using
      each kind's REAL per-OP access rule, not a same-named-but-different repo lookup and NOT
      assumed uniform across update/delete just because it happens to be for panel/pipelineStep:
      - panel (update AND delete, identical): `panelRepo.findByIdInternal` +
        `accessChecker.requireAccess("dashboard", dashboardId, ...)`, editor-or-owner.
      - dashboard `update`: `dashboardRepo.findById` (sharing-aware); owner passes directly, else
        `accessChecker.requireAccess("dashboard", ...)`, editor-or-owner.
      - dashboard `delete` — DIFFERENT from update: `dashboardRepo.findById` (sharing-aware, for
        the no-existence-leak 404), then a direct `ownerId == user.id` check, `Forbidden`
        otherwise — owner-only, matches `DashboardService.delete` exactly (does NOT go through
        `accessChecker`).
      - pipelineStep (update AND delete, identical): `pipelineStepRepo.findByIdInternal` + the
        pipeline-level owner-or-editor check `updateStep`/`deleteStep` perform.
      - dataSource/dataType (update AND delete, identical): `findByIdOwned` (owner-only,
        unchanged).
      - pipeline(-level) (update AND delete, identical for ACL): `findByIdOwned` for the ACL
        check itself (owner-only, unchanged) — but ALSO capture `findSummaryById`/
        `findSummaryByIdShared`'s joined `PipelineSummary` at this same point (design.md D4a's
        pipeline exception), since `priorState`/`resultingState` (task 2.1) need the joined
        fields `findByIdOwned`'s bare `Pipeline` doesn't carry.
      For `create`, decode `createPatch` into the matching `Create*Request`
      (`CreatePanelRequest`/`CreateDashboardRequest`/`StaticDataSourceRequest`/
      `CreatePipelineRequest` only — `dataType`/`pipelineStep` creates rejected here, design.md
      D1). Reject a dashboard-create edit whose decoded `ifExists` is `Some(...)` (design.md D3a).
      Return `Either[ServiceError, Vector[ResolvedEdit]]` (a resolved edit carries its
      pre-mutation full state for update/delete) — nothing mutates until every edit resolves.
- [x] 3.2 Extend 3.1's pre-validation to also authorize resources referenced FROM INSIDE a decoded
      `patch`/`createPatch` (design.md D2a — human-directed `implement-full-fix`, round 4):
      - panel `create`: `accessChecker.requireAccess("dashboard", decoded dashboardId, ...)`,
        editor-or-owner (mirrors `PanelService.create`).
      - pipeline `create`: `dataSourceRepo.findByIdOwned(decoded sourceDataSourceId, user)`
        (mirrors `PipelineRepository.create`).
      - panel `update`/`create`: when the config patch carries `dataTypeId`/`metricId`, run
        `rejectCompanionBinding`/`rejectUnresolvableMetric`'s SAME checks
        (`dataTypeRepo.findByIdOwned`/`metricRepo.findByIdOwned`) — mirrors
        `PanelService.scala:483-524`.
      - pipelineStep `update`: when the config patch is `JoinConfig`/`UnionConfig`/`LookupConfig`,
        run `dataSourceRepo.findByIdOwned` on `rightDataSourceId`/`otherDataSourceId`/
        `referenceDataSourceId` respectively — mirrors `PipelineService.scala:448,457,469`.
      A failure here fails pre-validation exactly like a top-level target failure — still nothing
      mutates until every edit (and every embedded reference) resolves.

## 4. Backend — forward apply

- [x] 4.1 Apply each resolved edit in caller order via the matching existing service method only
      (`PanelService.create/update/delete`, `DashboardService.create/update/delete`,
      `DataSourceService.createStatic/update/delete`, `DataTypeService.update/delete`,
      `PipelineService.create/updateName/delete`, `PipelineService.updateStep/deleteStep`) —
      every kind's `delete` method is in scope for forward-apply even where D1 marks its
      rollback `unrecoverable` (rollback limits apply to undoing the delete, not to whether the
      delete itself can be applied) — track successes as they happen. Every `update`/`delete`
      edit's `EditOutcome.priorState` is populated from the SAME pre-mutation state task 3.1
      already read during pre-validation (design.md D4a) — serialized into that kind's existing
      response format (pipeline: from task 3.1's joined `PipelineSummary` capture, not the bare
      `Pipeline`). Every successful `create`/`update` edit's `EditOutcome.resultingState`
      (design.md D4b) is populated from the domain object the forward-apply service call itself
      already returns — no second read for `create`; `update`'s resulting state is the SAME
      response the caller of `PATCH .../:id` would already get back.
- [x] 4.2 On the first failure, invoke the rollback walk (task 5) over the tracked successes, then
      return `PatchSetApplyResponse` with `failure` set and each edit's outcome (including
      `priorState` for every `update`/`delete` edit, regardless of final `status`, and
      `resultingState` for every successful `create`/`update`/`recreated` edit).

## 5. Backend — rollback

- [x] 5.1 Implement the reverse-order compensation walk (design.md D3): `create` → delete via the
      same service's delete method; `update` → reapply the captured full prior state as a
      full-overwrite inverse `Update*Request` through the same service method.
- [x] 5.2 Implement `delete` rollback per design.md D1/D3a's matrix: `panel` → `PanelService.create`
      from captured state, report `recreated` with the new panel id AND `resultingState` (the
      recreated panel's own `PanelResponse`, design.md D4b) — dashboard layout for the old id is
      NOT repointed, documented limit, no code needed for this; `pipelineStep` →
      `PipelineService.addStep` then `updateStep(position=...)` if it landed elsewhere, report
      `recreated` with the new step id AND `resultingState`; `dashboard`/`dataSource`/`dataType`/
      `pipeline` → mark `unrecoverable` in the response (`resultingState = None` — nothing was
      restored to report), never attempt a duplicative recreate.
- [x] 5.3 A compensating action that itself fails is logged and marks that edit `unrecoverable`
      too — never throws past the original failure (design.md Risks).

## 6. Backend — route

- [x] 6.1 Create `backend/src/main/scala/com/helio/api/routes/PatchSetRoutes.scala`:
      `POST /api/patch-sets/apply`, `entity(as[PatchSet])`, `ServiceResponse.run` (mirrors
      `CombinedProposalRoutes.scala`'s thin-shell style).
- [x] 6.2 Wire `PatchSetRoutes` into `ApiRoutes.scala`'s existing route composition.

## 7. Tests

- [x] 7.1 `PatchSetProtocolSpec.scala`: a `delete`-op `Edit` whose wire JSON carries a populated
      `patch` raises a `deserializationError` (task 1.1's new coverage).
- [x] 7.2 `PatchSetApplyServiceSpec.scala`: a mixed patch set (panel update + panel delete +
      dashboard update) applies cleanly, each edit reported `applied`.
- [x] 7.3 A mid-set failure on that same combination rolls back every edit — assert every touched
      resource matches its pre-apply state exactly EXCEPT the recreated panel's id (the ticket's
      own named test case, with the documented `recreated`/`newId` caveat from design.md D3a).
- [x] 7.4 An edit targeting a nonexistent or not-owned resource is rejected pre-apply; assert no
      resource changed. Cover at least one non-owner-but-editor-grantee case (panel or dashboard
      UPDATE) to prove the corrected D2 lookup accepts what the real PATCH route would also
      accept, AND a dashboard-DELETE edit from an editor (non-owner) grantee to prove D2's
      owner-only split is enforced (the real DELETE route would 403 this; pre-validation must
      reject it too, distinct from the update case).
- [x] 7.5 A `create` edit targeting `dataType` or `pipelineStep` is rejected pre-apply with a clear
      message.
- [x] 7.6 A dashboard-create edit whose `createPatch` sets `ifExists` is rejected pre-apply
      (design.md D3a).
- [x] 7.7 An unrecoverable delete rollback (e.g. a deleted `dataType` that must roll back due to a
      later failure) is reported as `unrecoverable` in the response, not silently hidden.
- [x] 7.8 `PatchSetRoutes` route test: a cross-owner edit is rejected identically to the target
      resource's own existing PATCH/DELETE route.
- [x] 7.9 (design.md D2a, task 3.2) A patch set `[panel-delete, panel-create targeting a
      dashboardId the caller has no access to]` is rejected pre-apply in full — assert the
      deleted panel is NOT touched (no needless identity-losing rollback for a set that should
      never have mutated anything). Also cover, matching each mirrored check's REAL semantics
      (not assumed — `rejectCompanionBinding` and `rejectUnresolvableMetric` reject on different
      conditions; verify against `PanelService.scala:476-524` before writing each case):
      - a panel-update edit whose config patch carries a `dataTypeId` the caller OWNS but that is
        a companion (non-pipeline-output) type is rejected pre-apply (mirrors
        `rejectCompanionBinding` — a foreign-owned or nonexistent `dataTypeId` is NOT rejected by
        this check; it passes through unchanged, matching the real `PanelService.update`'s own
        documented behavior — do not write a test asserting the opposite).
      - a panel-update edit whose config patch carries a `metricId` the caller does NOT own (or
        that doesn't resolve) is rejected pre-apply (mirrors `rejectUnresolvableMetric`, which —
        unlike the `dataTypeId` check — DOES actively reject a foreign/nonexistent reference).
      - a pipelineStep-update edit whose config patch is a `JoinConfig` referencing a
        foreign-owned `rightDataSourceId` is rejected pre-apply (mirrors the Join/Union/Lookup
        pre-flight checks, which are owner-only via `findByIdOwned`, same shape as `metricId`'s).
- [x] 7.10 (design.md D4a, ticket.md's prior-state AC) A panel-update edit's `EditOutcome.priorState`
      equals the existing `PanelResponse` shape for that panel's state before the update (assert
      field-for-field, not just non-empty); a panel-create edit's `EditOutcome.priorState` is
      `None`; an `unrecoverable` dataType-delete edit's `EditOutcome.priorState` is still populated
      (the dataType's pre-delete `DataTypeResponse`) even though its rollback itself could not
      restore it — proving prior-state emission is independent of rollback recoverability. ALSO
      cover a pipeline-update edit's `EditOutcome.priorState`: assert it equals the joined
      `PipelineSummaryResponse` shape (`sourceDataSourceName`/`outputDataTypeName` populated, not
      just the bare `Pipeline` fields) — the one kind requiring task 3.1's documented second read
      (design.md D4a's pipeline exception, round-6 REFUTE finding).
- [x] 7.11 (design.md D4b, ticket.md's "resulting resource states" Scope bullet) A successful
      panel-create edit's `EditOutcome.resultingState` equals the created panel's `PanelResponse`
      (including its new id); a successful panel-update edit's `EditOutcome.resultingState` equals
      the panel's `PanelResponse` AFTER the update; a plain (non-rolled-back) panel-delete edit's
      `EditOutcome.resultingState` is `None`; a `recreated` panel-delete-rollback's
      `EditOutcome.resultingState` equals the newly-recreated panel's `PanelResponse`.
- [x] 7.12 Run `sbt test`; confirm green alongside the existing suite.
