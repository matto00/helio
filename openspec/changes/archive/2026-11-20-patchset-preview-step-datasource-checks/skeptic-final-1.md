## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c5dd3e2053c5385b59cdcba8f72f333e4b97b0a7` (merge of origin/main `917c89172`, HEL-1720, into the branch).
The review base was resolved live: `resolve-review-base.sh` printed `917c89172c1644a0bc08a4f55ec8bf413633bbff`, exit 0.
The diff touches 18 backend files and the change dir. No `frontend/**` files changed, so step 4 (UI) does not apply.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/patchset-preview-step-datasource-checks/HEL-1722`.

**AC1: step create.** `PipelineStepWriteChecks.checkAdd` (new file) contains the body that used to be in `addStepReporting`, in the same order:
- type, rawConfigProblem, decode
- `referenceChecksF`: access, secondary ownership, lane, upsert target as the pipeline owner
- placement and `rejectIfReparents`

`PipelineStepCreate.addStepReporting` is now `checks.checkAdd(..., GraphChecks.Run)` followed by `persistNewStep`.
`PatchSetPipelineStepResolvers.resolvePipelineStepCreate` calls the same `ctx.stepWriteChecks.checkAdd` and passes the error through `prefixedWithEdit`.
The resolver's private copies (`authorizeSecondSourceForCreate`, `validateEmbeddedStepReferences`) are deleted.
`PipelineStepWriteChecks.editorAccess` is the same rule as `PipelineService.requireEditorAccess` (`findGrantRole == Some("editor")`, else `Forbidden("Forbidden")`).

**AC2: step update.** `checkUpdate` is the old `updateStep` body up to the repository call. I compared it line by line with the deleted code:
- not found / invisible pipeline: the same 404
- editor check: 403
- type change: 400
- when config is present: raw config, decode, `referenceChecksF` with the same `LaneScope.of(current, existing.parentStepId, Set(self), Some(self))`

`updateStep` keeps the two `updateInternal` arms exactly as before: no `actingUserId` without a config, `pipeline.ownerId` with one.
The inventory (`check-inventory.md` section 2) lists 2.1 to 2.14 and classifies each one, with a reason for every apply-only row (cycle guard, position, race, audit).

**AC3: data sources.**
- The `resolveDataSourceCreate` resolver calls `DataSourceService.validateStatic(request, DataSourceService.DatasetMaxRows)`, the same function and constant `createStatic` uses.
- The new pure function `DataSourceService.validateUpdate` is called first by both `update` and `resolveDataSourceUpdate`.

**AC4: roots-only pipeline create (D5).** On `preflight == Right(None)`, `PatchSetPipelineResolvers` runs `rootSchemas()` when `ctx.chargeFetches` is true.
- `PatchSetPreviewService` builds its context with `chargeFetches = true`, so preview always runs it.
- `PipelineRootDryRun.rootSchema` uses the same `validateStatic`, `dryRunSqlSchema` and `dryRunRestSchema` calls as the with-steps path.

**D5 deviation judged acceptable.** AC4 asks only for preview ("runs its inline roots' create checks at preview"). At apply the path is unchanged: `PipelineService.create` still runs the inline checks before it writes. That is exactly AC5's "apply behaviour unchanged".

**AC5 / C9: apply accepts exactly what it accepted before.** I tried to break it by looking for a set that main applies and HEAD now refuses at resolve. The new resolve-time checks fall into two groups.

Request-only or stored-state checks: type, config, decode, access, secondary ownership, upsert target, `validateStatic`, blank name. Could an earlier edit in the same set make one of these pass at forward time?
- `UpdateDataSourceRequest` carries only `name`, so a data-source update cannot change type or owner.
- `UpdatePipelineRequest` carries only `name`.
- `DataSourceService.delete` refuses any referenced source (`findReferences` gives a 409), so a delete cannot change a graph or a root set.
- `PatchSetRefs` lets only a panel bind to an earlier output create, so a step edit cannot name an object created earlier in the set.
- Grants are not patch-set editable.

I found no set where an earlier edit turns one of these checks from failing to passing.

Graph-dependent checks: lane, placement, `rejectIfReparents`. These are skipped (`GraphChecks.Skip`) when an earlier `pipelineStep` create, update or delete in the set touched the same pipeline. The pipeline id comes from the resolved action, not from request text. No other edit kind can change a step graph, so the skip covers every case.

Resolve callers: only `PatchSetApplyService` and `PatchSetPreviewService` call `resolveAll`. `DraftSaveService` builds the context only to compute definitions and fingerprints.

The refusals that now happen earlier are listed in inventory section 6. In each case the same input is refused, only sooner:
- the HEL-1265 upsert refusal is now a resolve-time 422
- a stale and lane-cyclic edit now answers 400 instead of 409
- a step update with no patch now answers 400 before the 404

**Parity spec is failable: red on main, reproduced myself.**
- `git diff --stat 31094b154 fd65407b2 -- backend/` shows only the new spec, so that commit's main code is unchanged.
- `git diff fd65407b2 HEAD` on the spec file is empty, so the spec is unchanged since the red run.
- I extracted `git archive fd65407b2` into a scratch directory and ran `sbt testOnly ...PatchSetPreviewWriteParitySpec` with `nice -n 19`, `-J-Xmx3g` and `ANTHROPIC_API_KEY` empty. Result: `Tests: succeeded 16, failed 41` and `[hel1468-guard] ScalaTest summary: failed=41`.
- I diffed my sorted list of failing tests against red-run.md's per-test list. All 41 test names are identical; only the two summary lines are formatted differently.
- On main, the two same-set apply entries pass and the "DIFFERENT pipeline" entry fails, as claimed.

**Mutations are real, reproduced myself** in a scratch copy of `git archive HEAD`. The worktree was not touched.
- Run A applied three mutations at once. Their expected failure sets do not overlap, so each failure can be attributed:
  - M3: `validateStatic` replaced by `Right`
  - M5: the D5 `rootSchemas()` call replaced by `Right(())`
  - M6: `touched` never grows

  Result: `failed 13`, made up of exactly the 6 dataSource-create entries, the 5 roots-only entries, and the two same-set apply entries ("two creates at position N then N+1", "drop D's lane..."). This matches mutations.md for M3, M5 and M6.

  M6 matters most: it proves the same-set entries really catch apply refusing a set it accepted before.
- Run B applied M1 (`checkAdd` replaced by a constant `Right`) and M4 (`validateUpdate` replaced by `Right`). Result: `failed 21`, made up of the 18 step-create rejection entries, the "DIFFERENT pipeline" entry, and the 2 blank-name dataSource-update entries. This matches M1 (19) plus M4 (2).
- I did not reproduce M2 or M7. The step-update red entries on main already show the spec catches a missing `checkUpdate`.

**Green at HEAD, run fresh in the worktree:**
- `testOnly com.helio.services.patchsets.* StepReferenceCheckDeferralSpec StepPlacementAgreementSpec CreateStepConfigNonRegressionSpec UpsertTargetWritableRlsSpec ExistenceNotLeakedRoutesSpec`
  - Result: `Suites: completed 44`, `Tests: succeeded 467, failed 0`, `[hel1468-guard] failed=0 aborted=0`.
  - Included: `PatchSetPreviewWriteParitySpec` (54 corpus entries plus 3 same-set, all passing), every `PatchSetUndo*Spec` (among them HEL-1720's new `PatchSetUndoBoundOutputPanelsSpec` and the changed `PatchSetUndoLaneSpec`), `PatchSetApplyServiceSpec` and `PatchSetPipelineStepGrantSpec`.
- `testOnly com.helio.api.routes.patchsets.* com.helio.api.routes.pipelines.*Step* ...`
  - Result: `Suites: completed 32`, `Tests: succeeded 371, failed 0`, `[hel1468-guard] failed=0`.
  - Includes `PatchSetStaleCheckRoutesSpec`, whose "both stale and lane-cyclic ... lane-cycle 400" test passes.

The evaluator's full 10-shard run (evaluation-2.md) is consistent with these results. I did not rely on it.

**Edited existing specs.** I read each edit. They match the documented precedence and wording flips; none of them weakens an assertion.
- The HEL-1265 test still checks that nothing was renamed or created.
- The grant-spec viewer cases still assert an exact `Forbidden`.

**Evidence persistence note.** My logs are in the session scratchpad, not the worktree: `head-run.log`, `head-run2.log`, `red-run.log`, `mut-a.log`, `mut-b.log`. I am read-only and did not copy them into the worktree. The load-bearing lines are pasted above (test counts and named failure sets, which can be checked against the spec's test names). No claim here depends on file mtimes.

### Verdict: CONFIRM

### Non-blocking notes
- The editor-grant rule now exists twice: `PipelineService.requireEditorAccess` and `PipelineStepWriteChecks.editorAccess` are identical copies. `PipelineService` could pass `PipelineStepWriteChecks.editorAccess(pipelineRepo)` so the two cannot drift apart.
- A lane create reads the step list twice before `persistNewStep` (once in `laneScopeF`, once in `placementCheck`). This repeats the evaluator's note; it is a performance nit only.
- HTTP behaviour visible to clients changes for some refusals: the HEL-1265 refusal moves from a 200 with `failure` to a 422, and stale plus lane-cyclic moves from 409 to 400. Both are documented and still refusals. I found no frontend or helio-mcp code that matches on the old wording.
- The parity corpus does not cover a lane-dependent step CREATE (disclosed in findings.md). Update covers `DependentViaLane`.
