## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD 625e1deff20f2ba73e98b2cfa0a1d0d1e298e25a. The planning artifacts are untracked under the change dir. I reviewed the current proposal.md, design.md, tasks.md and specs/pipeline-create-api/spec.md cold against the live source.

### What I verified (with evidence)

- **The leak and its root cause still match the live code.**
  - `PipelineService.create` (PipelineService.scala:147-187) runs `resolveRootSourceIds` (simple path) or `resolveRootDataSources` (transactional path) first.
  - Both call `resolveOneRootSourceId` → `resolveInlineRootSourceId` (774-818). That commits an inline source through `createStatic`, `createSql` or `createRest` before `pipelineRepo.create` or `createTransactional` runs.
  - Every step and Output check sits either in `createTransactional` before the transaction (`resolveStepRootIndex`, `resolveOutputRootIndex`, `validateStepCrossOwnerRefs`) or inside `buildStepsAction` (525-605) and `buildOutputsAction` (614-660). So in both cases the check runs after the source is committed.
- **Round-2 CR1 (C4 vs Decision 3, preview) is resolved.**
  - C4 in tasks.md and workflow-state, the proposal's last bullet, and the Non-Goal are now all scoped to the direct `POST /api/pipelines` route.
  - Decision 3 now says outright that patch-set apply moves from HTTP 200 with `failure` to a resolve-time 4xx, and preview moves from a 200 projection to a 4xx. It cites the HEL-1402 precedent.
  - Ground truth for "today": `PatchSetApplyService.scala:119-129` turns a forward `Left` into `Right(...failure=Some(msg))`. `PatchSetPreviewService.scala:44` shares `resolveAll`.
  - Task 1.4 and the spec scenario now assert the preview refusal.
- **Round-2 CR2 (sequence) is resolved.** design.md now has an "Exact sequence" section, referenced by tasks 2.1 and 2.2:
  1. Top-level checks.
  2. Root pass (a): shape checks plus read-only ownership.
  3. Pre-flight: indices → lane pass 1 → step pass 2 → Outputs.
  4. The ownership half of `validateStepCrossOwnerRefs`.
  5. Pass (b): create the inline sources.
  6. The post-creation steps.

  I checked the Risks claim "root shape/ownership errors still precede step errors" against this order and it holds. For single-class requests the order matches today's: today root resolution (226) precedes the step-root indices (322-339), which precede `validateStepCrossOwnerRefs` (344), which precedes `buildStepsAction`.
- **The pre-flight split is pure, as claimed.**
  - In `buildStepsAction` these checks need nothing but the request: duplicate clientId (536), type (538), `parentStepId` against earlier clientIds (543), `rawConfigProblem` (554-559), decode (561), and the forward lane reference (`rewriteLaneClientId` against the clientIds seen so far, 583-589).
  - In `buildOutputsAction` these need nothing but the request: `nodeStepClientId` (630), name (636), `OutputKind` (638), and `OutputConfigValidation`/`OutputCompare`/`PayloadOptIn` (validateOutputFieldMapping:681-685).
  - Only the fieldMapping slot and column checks need the node schema, and the design keeps those in place.
  - Lane pass 1 reproduces `validateLane` (429-441), including the skip on decode `Failure` (451). That keeps today's single-class outcomes: 422 "does not exist in this request" and the self/ancestor 400s.
- **Pass (a) on the simple path is consistent.** Today an existing `sourceId` on the simple path is only checked inside `pipelineRepo.create`, with the message "Data source not found: <id>". The new read-only `findByIdOwned` in pass (a) yields the same 404 text (as on the transactional path, 226), so C4 holds.
- **Decision 2 (compensation) is sound.**
  - `DataSourceService.delete` (DataSourceService.scala:649-660) runs as the user and refuses with 409 while references exist. Because the pipeline transaction has rolled back, there is no root reference, so the delete is reachable.
  - The precedent is real: `PipelineProposalService.cleanupSource` (71-75) and `FirstRunDashboardService.cleanupSource` (45-49).
  - Non-Goal (c) is accurately bounded. After `dataSourceRepo.insert`, `createSql` and `createRest` (SourceService.scala:79-85, 223-229) only either succeed (a schema fetch error becomes `fetchError`, not a `Left`) or fail the Future. So no post-insert `Left` escapes the tracking.
- **Decision 3a is implementable and safe.**
  - The forward outcome carries `resultingState` from the summary (PatchSetApplyForward.scala:86-89), and `ResolvedAction.PipelineCreate(request)` keeps the request (PatchSetApplyTypes.scala:56).
  - The rollback branch (PatchSetApplyRollback.scala:137-145) has `services.dataSourceService` available; the `DataSourceCreate` branch at 107-118 already uses it.
  - I found no cross-edit id-reference mechanism in the patch-set resolvers (I grepped for placeholder/ref plumbing), so no later edit can bind to the inline source before rollback.
- **The proof plan is red-first-capable.**
  - Every 1.1/1.1a/1.2/1.3 case with an inline `dataset` root commits through `createStatic` before the failing check, so a count by `owner_id` is red on the pre-fix tree.
  - The 1.4 status assertion is red today, because preview returns a 200 projection.
  - 1.1b now names the join/union/lookup requirement for the `findByIdInternal` throw branch.
  - 2.3's cleanup-fails case is labelled a guard and must be shown failable.
- **The spec delta** keeps every existing scenario of the requirement. The only change to existing text is that the "A failing step rolls back" scenario now states 422/400, which matches the live code (HEL-1402). It adds ACs per failure class. `openspec validate single-call-create-orphan-source --strict` reports "Change 'single-call-create-orphan-source' is valid".
- **AC coverage:**
  - AC1 (red-first through the real route) → C2, tasks 1.1 and 3.1.
  - AC2 (validate-first and/or one transaction; check the patch-set path) → Decisions 1, 3 and 3a. One transaction is rejected with a sound reason; the AC allows "and/or".
  - AC3 (no orphan on any 4xx/5xx; tests for step config, Output config and step type) → Decision 2 and task 1.1.
  - The residual gaps (bare-`url` auto-Connector, post-insert failed Future inside `SourceService`, `addRoot`, undo) are explicit Non-Goals with follow-up candidates.

### Verdict: CONFIRM

### Non-blocking notes

1. **Decision 3 and the proposal bullet name only "unknown step type or disallowed Output config"** as moving to resolve-time refusal on the patch-set path. But `resolvePipelineCreate` will reuse the whole pre-flight, so these also move from 200-with-`failure` to a resolve-time 4xx with the `edit N: ` prefix:
   - duplicate clientId
   - unresolvable `parentStepId`
   - undecodable config
   - lane reference errors
   - step/Output root-index errors
   - Output name/kind

   This is the intended behavior, but the executor should list the full set in the PR body or change notes so the evaluator does not read the extra classes as unplanned drift.
2. **Decision 1's opening paragraph puts root shape inside the pre-flight, but the "Exact sequence" puts it in root pass (a).** Treat the Exact sequence as authoritative. In `resolvePipelineCreate`, the existing per-root loop (blank 400, ownership 404) should stay ahead of the reused step/Output pre-flight. That keeps root errors first there too.
3. **Patch-set multi-error precedence changes.** Today `rawConfigProblem` returns None for an unknown kind, so step 0 with an unknown type plus step 1 with a refused config resolves to step 1's 422. After the change, step 0's 400 wins. This only affects multi-error requests, which the existing Risks bullets already cover.
4. **Where the `sourceService == null || dataSourceService == null` InternalError check (775-776) lands is unspecified.** Production and the planned specs wire both services, so this is harmless either way. Keeping it at creation time (pass b) is fine.
