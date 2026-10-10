## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9402b22431a88307b2b3ac4fb3673a13d0335a62` against the live-resolved base `625e1deff20f2ba73e98b2cfa0a1d0d1e298e25a` (`resolve-review-base.sh`, exit 0). The diff is backend-only: `PipelineService.scala`, the new `PipelineCreatePreflight.scala`, `PatchSetApplyResolvers.scala`, `PatchSetApplyRollback.scala`, three new specs, and change artifacts. No UI files changed, so step 4 does not apply.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/single-call-create-orphan-source/HEL-1469`.
- **Write ordering, read from the code** (`PipelineService.scala:152-339`):
  - `create` runs the pure top-level checks, then `checkedCreate`.
  - `checkedCreate` runs `checkRootsReadOnly` first (root shape plus existing-`sourceId` ownership, read-only). Then comes `PipelineCreatePreflight.run`, on the transactional path only. Then the ownership half of `validateStepCrossOwnerRefs`. Only after that does `createWithInlineRoots` run, wrapped in `compensatingInlineSources`.
  - `compensatingInlineSources` uses `Future.unit.flatMap(_ => body).transformWith`. On a `Left` it deletes the created ids and then returns the original `Left`. On a `Failure` it deletes and then re-raises the original exception. Delete failures are `.recover`-logged.
  - The in-transaction `buildStepsAction`/`buildOutputsAction` call the same `checkStep`/`checkOutput`/`validateOutputConfig`. The removed in-transaction code (read from the `-` side of the diff) has the same messages and statuses as the extracted helpers.
- **Compensation cannot destroy a live source.** `DataSourceService.delete` (`DataSourceService.scala:649-660`) refuses with a 409 when `findReferences` is non-empty. Suppose a pipeline row had committed but the Future then failed (a post-commit audit or response error). The compensating delete would be refused rather than strand the pipeline. So even the hard edge case fails safe. Deletes run as the user (C3).
- **Patch-set.**
  - `resolvePipelineCreate` now runs `PipelineCreatePreflight.run` after the root loop. It edit-prefixes `BadRequest`/`UnprocessableEntity`, which are the only error types the pre-flight produces.
  - The rollback `PipelineCreate` branch deletes the pipeline first. On success it deletes the inline-typed roots, matched by position against the forward summary's `roots[].dataSourceId`. If the pipeline delete fails, it attempts no source delete.
  - The only callers of `pipelineService.create` are `PipelineRoutes.scala:34` and `PatchSetApplyForward.scala:87` (grep). Both are now covered.
- **Gates, re-run myself on HEAD in the worktree.** I ran `sbt -J-Xmx3g testOnly` on the three new specs plus `PipelineCreateStepConfigRoutesSpec`. Exit 0, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 26, failed 0`. For the full suite I relied on the evaluator's pasted `testFull` on this same HEAD: 6554 succeeded, 0 failed, guard line present.
- **Mutation: is the compensation actually exercised, and does validate-first create nothing?**
  - In a throwaway detached worktree at the same HEAD (since removed), I replaced the `Success(left)` arm of `compensatingInlineSources` with `Future.successful(left)`, so a `Left` no longer triggers cleanup. Then I re-ran the three new specs. Result: `failed=1`. The failure was exactly `leave no data source when an Output fieldMapping names a column the inline source lacks ... 1 was not equal to 0`.
  - Every request-only class stayed green with compensation disabled: step config 422, unknown type 400, Output config 400, both lane cases, and both multi-root 404 cases. Those classes therefore never create a source in the first place, which is real validate-first and not cleanup after the fact.
  - The schema-dependent case really runs through compensation.
  - The failed-Future branch is pinned separately by `PipelineCreateInlineSourceCleanupSpec`. It is red on the pre-fix tree per red-evidence.md, and the evaluator independently re-measured that red (14 failed on 625e1deff with only the new specs added).
- **AC1, live, through the real route** (dev backend :9808, throwaway user `cec26bc5-337c-4d34-be95-7d5f1bf455e2` / `hel1469-skeptic-1791625856@helio.test`). Count is `GET /api/data-sources` items:
  - compute step with an unknown function: **422** `Step 'calc': compute: invalid expression: 'nosuchfn' ...`, sources 0 -> 0. This is the original incident.
  - unknown step type: **400**, 0 -> 0.
  - table Output with key `notAKey`: **400**, 0 -> 0.
  - metric `fieldMapping` naming `does_not_exist` (post-creation, so compensation runs): **400**, 0 -> 0.
  - inline root plus an unknown `sourceId` root: **404**, 0 -> 0.
  - Positive control (valid select step): **201**, 0 -> 1. This shows the count probe can register a source.
  - Created ids: pipeline `1561892c-03aa-465a-9107-1b09d29d7f1a` and source `ead838cf-0a9b-4141-a38f-e5bdbd59440b`. I deleted both by exact id (204, 204). Afterwards `GET /api/pipelines` returned `[]` and `GET /api/data-sources` returned `total 0`. The throwaway user row itself remains; there is no user-delete API.
- **AC2.** Validation now runs before writes (`PipelineCreatePreflight` plus root pass (a)), with compensation for post-creation failures. The patch-set `resolvePipelineCreate` path was checked and fixed, and so was the mid-set rollback.
- **AC3.** Tests exist per named class (step config, Output config, step type) and per post-creation class (fieldMapping, failed Future on both paths). Each asserts the exact-owner-id `data_sources` count alongside the status (C1). The patch-set apply, preview and rollback cases are present too.
- **Design soundness.** Validate-first combined with a narrow compensating delete is the right shape. A cross-service transaction would have held a DB connection under `withUserContext` across outbound schema-fetch I/O. The pipeline, step and Output rows stay in one composed transaction, as HEL-906 ruled. The single exception (inline sources) is documented in the `create` docstring. Behavior shifts (multi-error precedence, and patch-set apply/preview now refusing at resolve time with 4xx) are stated in `behavior-changes.md`, and they extend HEL-1402's own precedent.

### Verdict: CONFIRM

### Non-blocking notes
- `POST /api/pipelines/:id/roots` (`addRoot`) with an inline root that then fails has the same class of leak. It is listed as a follow-up non-goal; please file it so it is not lost.
- Other stated follow-ups that should become tickets:
  - the bare-`url` `rest_api` implicit "Auto:" Connector survives compensation
  - `SourceService.createSql`/`createRest` can fail after their own insert
  - patch-set UNDO of an applied inline-root create
- `PatchSetApplyRollback.deleteInlineRootSources`: if the summary's `roots` array is missing or shorter than `request.roots`, `zip` silently drops entries and the edit still reports `rolledBack`. A warn on a size mismatch would make that loud (the evaluator raised the same point).
- A delete that throws (a failed Future, not a `Left`) in `deleteInlineRootSources` is not caught locally. It falls through to the outer `NonFatal` recover (`PatchSetApplyRollback.scala:57`), which reports it as unrecoverable. That is acceptable.
- No test pins the "pipeline delete fails, so no source delete is attempted" rollback branch. It is correct by reading.
