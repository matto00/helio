## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

**Round-1 blocking CRs — re-checked against ground truth:**

1. **CR1 (PipelineStepRepository owner-JOIN unaddressed)** — Read `PipelineStepRepository.scala` in full: confirmed all five methods (`listByPipeline`, `findById`, `insert`, `update`, `delete`) still use the owner JOIN in the current codebase (pre-implementation). The updated `design.md` now contains Decision D2b, which explicitly plans `listByPipelineInternal`, `findByIdInternal`, and privileged insert/update/delete variants that drop the owner-JOIN. Tasks 2.3–2.5 specify these additions. Tasks 3.4–3.7 specify that `listSteps`, `addStep`, `updateStep`, and `deleteStep` switch to these internal variants after ACL confirmation. **Resolved.**

2. **CR2 (PipelineService.analyze not updated)** — Read `PipelineService.analyze` in full: it currently calls both `pipelineRepo.findSummaryById(pipelineId, user)` (owner-only), `pipelineRepo.findById(pipelineId, user)` (owner-only), and `pipelineStepRepo.listByPipeline(pipelineId, user)` (owner-JOIN). Decision D3 now explicitly says "`analyze` also moves to `findByIdShared` + `pipelineStepRepo.listByPipelineInternal`." Task 3.8 explicitly covers this. **Resolved.**

3. **CR3 (PipelineRunHistoryRoutes and PipelineRunSubmitRoutes missing)** — Read `PipelineRunHistoryRoutes.scala` and `PipelineRunSubmitRoutes.scala`: confirmed they call `runService.history` and `runService.submit` respectively, both of which currently use `pipelineRepo.findById` (owner-only). Tasks 4.2 and 4.3 now explicitly cover run-history and run-submit route updates. Task 3.10 updates `PipelineRunService.run/runDry` (`submit` method) to use `findByIdShared` plus an editor-or-owner guard. **Resolved.**

4. **CR4 (PipelineRunService.pipelineExists ambiguity)** — Read `PipelineRunStreamRoutes.scala`: it calls `runService.pipelineExists(pipelineId, user)`. Read `PipelineRunService.scala`: `pipelineExists` delegates to `pipelineRepo.findById` (owner-only). Task 3.9 now specifies adding `pipelineExistsShared(id, user)` to `PipelineRunService`. Decision D6 specifies the method signature and that routes use it. Task 4.1 updates `PipelineRunStreamRoutes` to call it. **Resolved.**

**Additional ground-truth checks (fresh, not from round-1 report):**

5. **Flyway version** — Confirmed V38 is the current latest (`V38__rls_privileged_grants.sql` present, no V39). Design correctly targets V39. No conflict.

6. **ResourcePermissionRepository uses withSystemContext throughout** — Read in full. All five methods (`insert`, `delete`, `findByResource`, `findGrant`, `hasPublicViewerGrant`) use `withSystemContext`. This means V36 RLS policies on `resource_permissions` are bypassed by the service path. V39's OR-ed pipeline-owner RLS policies are defence-in-depth only. Design D1's claim is correct. No service-path risk.

7. **V36 RLS policies on resource_permissions** — Read in full. Confirmed they join only to `dashboards.owner_id` — pipeline owners cannot INSERT pipeline grants under the app pool without V39. The design correctly identifies this risk and its mitigation.

8. **PermissionService pattern** — Read in full. It is clean and matches the design's D4 description: owner-only ACL via `requireOwnerOnly`, hard-coded `ResourceType`, standard `list/grant/revoke` surface. `PipelinePermissionService` mirroring this is straightforward.

9. **Spec coverage of ticket ACs** — Traced each AC against the three spec deltas:
   - AC1 (owner can grant via share UI): covered by pipeline-sharing spec "Owner can manage sharing grants" + "Frontend share dialog."
   - AC2 (viewer read-only): covered by pipeline-sharing spec "Viewer grantee has read-only access."
   - AC3 (editor mutate steps + trigger runs, no delete/transfer): covered by pipeline-sharing spec "Editor grantee can mutate steps and trigger runs."
   - AC4 (cross-user no grant → 404): covered by pipeline-sharing spec "Cross-user caller with no grant receives 404."
   - AC5 (test matrix): covered by task 7.1.
   - AC6 (frontend share dialog): covered by pipeline-sharing spec "Frontend share dialog."

10. **previewStep endpoint scope** — `PipelineRunStatusRoutes.scala` exposes `GET /api/pipelines/:id/steps/:stepId/preview` which calls `runService.previewStep` (owner-only). The pipeline-sharing spec's viewer requirement enumerates specific endpoints and does NOT include the preview endpoint. This omission appears intentional (preview is an execution-path tray, not a read endpoint). Neither viewer nor editor is promised access to it. No gap.

11. **No-public-viewer guard in PipelinePermissionService** — `GrantPermissionRequest.granteeId` is `Option[String]`. The current `PermissionService.grant` passes `None` through to the repo (inserting a null-grantee row), which is how public-viewer dashboard grants work. For the pipeline service, this path must be rejected with 400 (spec scenario: "Null grantee (public-viewer) grant is rejected"). The task (3.11) says "no public-viewer grant" without spelling out the required `granteeId.isEmpty → BadRequest` guard in the service method. There is no DB-level guard preventing null-grantee pipeline rows (`grantee_id` is nullable; V39 does not add a pipeline-specific CHECK). The rejection must be at the service layer. The spec scenario for this is explicit and task 7.1 covers "all pipeline route surfaces" — a test for this scenario would catch the omission. The implementer must read the spec scenario carefully to avoid silently permitting null-grantee pipeline grants.

### Verdict: CONFIRM

### Non-blocking notes

- **Task 3.10 naming vs. implementation**: The task says "update `PipelineRunService.run` and `runDry`" but the actual method is a single `submit(pipelineId, isDry, user)` method that handles both. The intent is clear, but the implementer should be aware the target is `submit`. No confusion risk given the codebase is small.

- **No-public-viewer guard needs explicit implementation**: Task 3.11 says "no public-viewer grant" without calling out the specific guard needed in `PipelinePermissionService.grant`: `if (request.granteeId.isEmpty) return Future.successful(Left(ServiceError.BadRequest("Public viewer grants are not supported for pipelines")))`. The spec scenario is explicit (400 expected). Recommend the implementer add this guard before calling `permissionRepo.insert`. The absence of a DB-level constraint means a silent fail-open is possible if the guard is omitted — the test matrix in task 7.1 should include this scenario explicitly.

- **`previewStep` viewer/editor access**: Scoping it as owner-only is consistent with the spec's enumerated viewer surface. If editors are expected to preview steps they're editing, a future ticket should address it — it is out of scope here per the spec.
