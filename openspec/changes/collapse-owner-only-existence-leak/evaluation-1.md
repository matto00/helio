## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 455b939473fd8ce5e973f49807186bb25d6f1fbc against base 7b146b34 (live-resolved).

### Phase 1: Spec Review — FAIL
Issues:
- AC 1 ("an authenticated caller cannot distinguish a real-but-unowned resource from a nonexistent one on owner-only routes, status AND serialized body identical") is not met on one reachable path. `POST /api/patch-sets/apply` and `/preview` with a `pipelineStep` update/delete edit:
  - foreign step (stranger, live probe, step f3ce56db-... owned by dev account): `404 {"message":"Pipeline not found"}`
  - nonexistent step: `404 {"message":"edit 0: pipeline step not found"}`
  - Bodies differ, so existence of a pipeline-step id under another tenant is still learnable. Cause: `PatchSetApplyResolvers.scala` ~577 and ~618 resolve the step with `pipelineStepRepo.findByIdInternal` (ACL-bypassing), then `authorizeEditorOrOwnerOnPipeline` (line ~114) answers a no-grant caller with `NotFound("Pipeline not found")`. The executor fixed the identical pattern for panels in this same file (and the classification doc itself states a message mismatch is an oracle), but the pipelineStep resolvers were not converted. The classification only audited `Forbidden` producers, not NotFound-message divergence on the same routes.
  - Other patch-set kinds probed live (dashboard, pipeline, dataSource, panel update/delete, output) are identical for foreign vs absent.
- Everything else checked is met: HEL-590 `mapForbiddenToNotFound` removed; legit 403s retained (viewer, tier, PAT confinement, grantee on requireOwnerOnly); no 403-keyed frontend handling exists on these routes (frontend `classifyRequestError` already maps 404 to not-found; no frontend change needed); helio-mcp mapping never keyed on 403 (comment updated); PublicRouteOwnerIdLeakSpec unchanged and green. No CONSTRAINTS in workflow-state.md (empty).

### Phase 2: Code Review — FAIL
Gates (own fresh runs, WORKTREE_PATH):
- `cd backend && nice -n 19 sbt testFull`: 5302 succeeded, 0 failed, 368 suites (361 s). ExistenceNotLeakedRoutesSpec (41 rows/guards) and PublicRouteOwnerIdLeakSpec both ran green. No known flake (HEL-1228/1225, HEL-1215, HEL-1247) hit.
- Frontend gates: not run, no `frontend/**` files changed (only helio-mcp comment).
Verification of the Forbidden-producer classification against live code:
- `DashboardRepository.findById(id, Some(user))` (DashboardRepository.scala:71-90): owner -> Some; non-owner -> Some only with a user-specific grant; else None. Confirmed visibility-filtered.
- `PanelRepository.findById(id, Some(user))` (:129+): owner-of-parent / grantee-of-parent / public-dashboard grant only. Confirmed. `submitForm` non-owner 403 is therefore non-oracle (probe: stranger on private panel -> 404 identical to absent).
- `PipelineRepository.findByIdShared` (:68-93): owner or explicit grantee only. Confirmed.
- My independent grep of `ServiceError.Forbidden(` / `StatusCodes.Forbidden` matches the pinned inventory; each retained site sits behind a visibility-filtered lookup or is non-resource-specific. Classification is accurate for Forbidden producers.
- Pipeline-step routes `PATCH/DELETE /api/pipeline-steps/:id` (untested by the new spec): code reads (`PipelineService.updateStep`/`deleteStep`) resolve parent via `findByIdShared(.., Some(user))` and return the identical `Pipeline step not found: <id>` on None. Live probe as stranger: foreign and absent both `404 {"message":"Pipeline step not found: <id>"}`. Non-oracle claim confirmed. (The patch-set pipelineStep path above is the separate, divergent one.)
Live stranger probes (foreign vs absent, status+body identical): PATCH/DELETE/duplicate/export/permissions/share-tokens on dashboards; PATCH/DELETE/duplicate/submit on panels; GET/DELETE/run/outputs on pipelines. All identical 404.
Issues:
- Test gap that let the oracle through: `ExistenceNotLeakedRoutesSpec.rows` has no row for `/api/pipeline-steps/:id` (PATCH/DELETE/reorder-style step routes) and no row for `patch-sets/apply` with a `pipelineStep` target (the tasks.md design-gate note required service-layer paths to be covered). The completeness guard is keyed on file name only (`PatchSetApplyResolvers.scala` is "covered" by the panel rows), so it cannot detect an uncovered kind inside a covered file.
- Red-first: spec is genuinely failable by inspection (asserts foreign status == 404 and foreign == nonexistent, plus an owner control that must not be 404/403); the missing step rows are the only weakness.

### Phase 3: UI Review — PASS
- Servers: executor's dev servers on 6434/9341 are this worktree's cwd, started 21:04:55 after the last main-source edit (21:04:23); reused.
- Stranger (a non-owner free-tier user) opening the dev owner's dashboard URL: page renders the normal "Dashboard not found / That dashboard doesn't exist or you don't have access to it. / Back to dashboards" state in both dark (data-theme=dark) and light (data-theme=light). 0 console errors.
- No frontend code changed; breakpoints/keyboard not affected.

### Overall: FAIL

### Change Requests
1. `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` (~lines 577 and 618, `resolvePipelineStepUpdate`/`resolvePipelineStepDelete`): make a step the caller cannot see answer exactly `NotFound(s"edit $index: pipeline step not found")`. E.g. after `findByIdInternal` returns Some, resolve the parent with `ctx.pipelineRepo.findByIdShared(existing.pipelineId, Some(user))` and on None return that same message; only then run the editor/owner check (Forbidden stays for visible-but-viewer grantees). Do not change `authorizeEditorOrOwnerOnPipeline`'s message for other callers unless they have the same issue.
2. `ExistenceNotLeakedRoutesSpec.scala`: add rows (stranger foreign-vs-absent, byte-identical, red before fix 1) for `PATCH /api/pipeline-steps/{id}`, `DELETE /api/pipeline-steps/{id}`, and `POST /api/patch-sets/apply` with `pipelineStep` update and delete targets (this needs a seeded step id and a `Step` target in `targetIdOf`; seed a step row in `seedOwned`). Also add preview if cheap. Record the red output before the fix.
3. Re-sweep for the same class: any other `resolve*` in `PatchSetApplyResolvers`/`PatchSetUndo*` that reads with `findByIdInternal` and then returns a differently worded NotFound for a no-grant caller (my probes covered dashboard/pipeline/dataSource/panel/output apply and found them identical; undo routes and `PatchSetUndoConflictCheck.scala:95,173,208` were not probed). Update `forbidden-classification.md` section A/D accordingly.

### Non-blocking Suggestions
- Timing difference (extra `findGrant` query on foreign arm) is documented as a non-goal; fine.
- The completeness guard could assert per-kind coverage (e.g. each `target.kind` handled by the patch-set resolvers appears in a row) rather than file-name coverage.
- Dev DB cleanup done by exact id: dashboard feaf2cbe-0c50-4290-9fe6-39b83f022796 (cascaded its panel 1b1b92f8-...) and user 7c05fd2e-b9bf-40d7-bc43-63c785c82cf3 deleted. No existing pipeline/step rows were modified (probes were stranger-side and rejected).
