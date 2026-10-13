## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 3cb2641fa45406d2820eaa1d1024564aebf42a38 (single commit over live-resolved base
d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc via `resolve-review-base.sh`, exit 0).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/grantee-drift-preview-recheck/HEL-1516`.
- **Diff read in full** (`git diff d16e58d7e...HEAD -- backend/src/main`): 4 main files (PipelineRepository,
  PipelineRunRepository doc-only, PipelineAnalyzeReads, PipelineRunPreview), 2 test files. No migration, no API
  shape change, no frontend change, so the UI/design step does not apply.
- **AC1 (grantee drift = owner drift), traced:**
  - `PipelineRepository.findLastSourceSchemaInternal` reads `last_source_schema` by id under `withSystemContext`.
    The only caller is analyze, after `findByIdShared(pipelineId, Some(user))` returned the pipeline.
  - `PipelineAnalyzeReads` computes drift against `dataSourceRepo.findByIdOwnedByInternal(primaryDsId, pipeline.ownerId)`.
    `primaryDsId` is `rootDataSourceIds.headOption`, the same position-ordered list `rootSchemas` is built from, so it
    names the same root as before.
  - For the owner, `findByIdOwned` (DataSourceRepository.scala:182, `ownerId === caller`) and `findByIdOwnedByInternal`
    (:190-195, `ownerId === ownerUuid`) apply the same filter, so owner behaviour is unchanged. The PIN case passes.
  - `sourceSchemas`, projections and cost inputs still use the caller's `findByIdOwned`, as A1 states.
- **AC2 (preview re-check), traced:**
  - `checkPreviewAccessInternal` checks, in order: no row -> `PipelineGone`; owner -> `Authorized`; then a `pipeline`
    grant (any role, or `editor` only when `requireEditor`). This matches `findByIdShared`'s grant predicate
    (PipelineRepository.scala:75-100: owner, or any `pipeline` permission row) and the replaced `authorizedForAi`
    (owner, or `findGrantRole == editor`).
  - `guardedExecution` wraps both `backend.execute` sites: the source-level arm (`requireEditor = false`) and the
    step arm (`requireEditor = closureHasEnabledAiStep`). The `recover` sits inside the guarded thunk, so the
    403/404 results are not masked.
  - The empty-roots branch now checks `findByIdInternal`: missing -> 404, present -> the existing 422 (A3).
  - `previewOutputs` reaches the re-check through `previewAtNode` on both arms.
- **Red on unchanged main, reproduced independently.** I extracted base `d16e58d7e` (`git archive backend schemas`)
  into a scratch dir, added only the new spec, and ran
  `nice -n 19 sbt -J-Xmx3g "testOnly ...Hel1516GranteeDriftPreviewSpec"`. Result: `Tests: succeeded 4, failed 6`.
  The failures are the 6 DEFECT cases. The messages match red-run.md: grantee drift `None` vs owner
  `Some(...extra...)`; an editor's step and Output previews return `Right(...)` after revoke; S1 returns
  `UnprocessableEntity(DataSource not found...)`; S2 returns `Right(...)`. The guards and pins passed.
  The spec runs the service under `helio_migration_test NOSUPERUSER ... NOBYPASSRLS`.
- **Guards are failable, reproduced on fixed code copied into the scratch dir:**
  - M2 (drift current schema read via `findByIdOwned(primaryDsId, user)`): 2 failed, (a) and GUARD (b). (b) fails with
    `Some(...removedColumns name, score...) was not equal to None`.
  - M5 (step arm `requireEditor = false`): 1 failed, GUARD (g). The viewer reached the AI step
    (`ai-unavailable: spy`).
  - With the fixed code unmutated, the other 8 cases passed in the same runs.
- **Green in the worktree (fresh, foreground, nice 19, -Xmx3g):**
  - `Hel1516GranteeDriftPreviewSpec`, `ExistenceNotLeakedRoutesSpec`, `Hel1503EditorRunGapsSpec`: Suites 3, Tests 84
    succeeded, 0 failed.
  - `PipelineRunServiceSpec`, `OutputRoutesSpec`, `*PipelineRunRoutesSpec`, `*PipelineAnalyze*Spec`,
    `*PipelineAclSpec`: Suites 15, Tests 477 succeeded, 0 failed.
  - I did not run the full `sbt testFull` locally because of the 600 s foreground cap. It is left to CI.
- **`ExistenceNotLeakedRoutesSpec`:** the Forbidden-producer count for `PipelineRunPreview.scala` stays 1. There is
  exactly one `ServiceError.Forbidden` in `guardedExecution`, replacing the one in `authorizedForAi`. The
  classification comment has been rewritten and the spec's mechanism is unchanged. The suite passes.
- **Repo checks:** `npm run check:scala-quality` exit 0 ("clean", soft warnings only). `npm run check:openspec`
  reports "openspec/ is clean".
- **Claims vs ground truth:** red-run.md's red output and its M2/M5 outcomes match what I reproduced.
  files-modified.md lists full paths. The worktree is clean apart from the evaluator's untracked evaluation-1.md.
  HEAD did not move during the review.

### Verdict: CONFIRM

The delivered behaviour matches the ticket's ACs and the design's assumed calls. A1: a grantee gets the owner's drift
and the rest of analyze stays in the grantee's view. A2: the re-check enforces the access the preview already
required, so viewers keep non-AI previews. A3: a deleted pipeline returns 404 instead of 422. A1-A3 remain owner
product calls, and the PR is parked for OWNER REVIEW regardless of this verdict.

### Non-blocking notes

- `openspec/changes/archive/2026-10-02-collapse-owner-only-existence-leak/forbidden-classification.md` (row at :52,
  note at :101-104) still names `authorizedForAi`, which this change removes. It is an archived, historical document
  and the live pin comment is updated, but a later reader following the cross-reference will not find the symbol.
- A1 disclosure, for the owner's review: a viewer now sees column names (and types) of an owner-only source through
  `sourceSchemaDrift`. The design argues this is no new class of information because preview rows are already
  visible. That holds only for columns that survive into the previewed output, not for removed columns. Owner call.
- The race after the re-check is accepted, as in HEL-1503 D4.
