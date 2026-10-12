## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `56a46a0ac3f14cd817406d1323f8c274b6da0b7e` (branch `bug/editor-run-baseline-statuses/HEL-1503`).
Diff base: `3c0ed6ce342c0c1a297d739a990e5ea18e8e55d5`, resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS
- AC1 (editor baseline as the owner sees it): `PipelineRunSucceededWrites` reads with `findByIdOwnedByInternal(src, pipelineOwnerId)` on both branches. The write branches on `ownerRun`. Tests (a), (b) and the owner pin (b2) cover it.
- AC2 (mid-submit delete gives 404, never 5xx): the admission paths read the row with `FOR KEY SHARE` and return `PipelineGone`, which maps to `NotFound`. The empty-roots branch now does an existence check (404 if the pipeline is gone, 422 otherwise). S1 and S2 cover real and dry runs for owner and editor, and the 422 pin is kept.
- AC3 (dry run re-verified before executing): `checkRunAuthorizationInternal` runs after the rate-limit check and before the `queued`/`running` events and `backend.execute`.
- AC4: the RENAMED delta is present. Both Purpose sections are edited directly, and the TBD is gone (`grep TBD` finds nothing in either main spec). The main spec's requirement title still says "per-user". That is expected: the RENAMED delta is applied at archive.
- AC5: no repository split, and `triggered_by_user_id` is not exposed anywhere (no protocol or route change in the diff).
- AC6: the new spec runs on `VerifiedEmbeddedPostgres.start` as `helio_migration_test LOGIN NOSUPERUSER ... NOBYPASSRLS`. That role owns the tables, but V35 sets `FORCE ROW LEVEL SECURITY` on `pipelines`, `data_sources`, `pipeline_runs` and `pipeline_steps`, so RLS really applies to it. `[hel1468-guard]` appears in every sbt run. No migration.
- tasks.md: every item is ticked and matches the diff. `openspec validate --strict` reports the change as valid, and `check:openspec` is clean.
- CONSTRAINTS: empty, so nothing to honour.

### Phase 2: Code Review — FAIL
Gates I ran myself:
- `nice -n 19 sbt -J-Xmx3g testFull` in WORKTREE_PATH: exit 0. Output: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, Suites completed 551, Tests succeeded 7340, failed 0, canceled 4.
- Targeted `testOnly` of Hel1503EditorRunGapsSpec, PipelineRunEditorPersistenceSpec, PipelineRunRepositorySpec and ExistenceNotLeakedRoutesSpec: 134/134 passed, `[hel1468-guard] failed=0`.
- Mutations, each applied to a scratch `git archive` export of 56a46a0ac (the worktree itself was never modified) and run with `testOnly Hel1503EditorRunGapsSpec`. Every run printed `[hel1468-guard]`:
  - M1 (owner-scoped write on the editor branch): 2 tests failed, the editor baseline and the editor-owned primary root cases. Matches red-run.md.
  - M5a (no `FOR KEY SHARE` on the owner path, PipelineRunRepository.scala:150): 1 failed, the OWNER key-share test. Matches.
  - M5b (no `FOR KEY SHARE` on the grantee path, :223): 1 failed, the GRANTEE key-share test. Matches.
  - M6 (dry-run re-check replaced by `Authorized`): 2 failed, the S2 dry-run 404 and the revoked-editor 403 cases. Matches.
  - Unmutated control: 13/13 passed.
- `npm run check:scala-quality`: clean (soft warnings only). `check:test-temp-dir-hygiene`: clean.

The `withSystemContext` sites added in this diff:
- `updateLastSourceSchemaInternal`, `findByIdOwnedByInternal` and `checkRunAuthorizationInternal` each carry a justification comment.
- Each keys only on the already-authorized pipeline id, the pipeline owner id, or the submitter.
- The `findByIdInternal` call in the executor has its caller added to the documented list of permitted callers.

Issues:
1. **Inline FQN.** This breaks a [mechanical] rule (CONTRIBUTING.md:70, "never inline a fully-qualified name when an import would do"). `backend/src/test/scala/com/helio/services/pipelines/Hel1503EditorRunGapsSpec.scala:93` has `private def priv[T](a: slick.dbio.DBIO[T]): T`. The same line exists in PipelineRunEditorPersistenceSpec, but this file is new code. `check:scala-quality` does not catch `slick.` prefixes, so a passing check does not clear it.
2. **Comments that now contradict the code.** CONTRIBUTING.md "Comments": a comment that restates *what* the code does "silently stops being true". These comments sit on the admission and lock-ordering contract this change rewrote:
   - `PipelineRunRepository.scala:111-123` (`insertRunIfUnderConcurrencyCap` scaladoc) still says step 1 is `pg_advisory_xact_lock` and step 2 is "the pipeline-owned check (`pipelineOwnedAction` ...)". The method now (a) reads the row with `FOR KEY SHARE` first, giving `PipelineGone` or `NotAuthorized`, then (b) takes the advisory lock, then (c) counts and inserts. It no longer calls `pipelineOwnedAction`. The lock order is exactly what design.md D3 says matters.
   - `PipelineRunRepository.scala:203-207` (`insertGranteeRunIfUnderOwnerCap` scaladoc): "(1) the pipeline's owner id is read" omits the key-share lock. The sentence "a grant revoked ..., or a pipeline deleted since, yields `NotAuthorized` (or `PipelineGone` when the pipeline is deleted ...)" contradicts itself.
   - `PipelineRunExecutor.scala:176`: the `NotAuthorized` arm comment still says "or the pipeline deleted mid-submit". That case is now the `PipelineGone` arm directly below it.
   - `PipelineRunExecutor.scala:152-153`: "dry runs skip this call entirely ... and proceed straight to `backend.execute`". Dry runs now go through `checkRunAuthorizationInternal` first.

### Phase 3: UI Review — N/A
The only Phase 3 trigger the diff matches is `openspec/specs/**`, and that change is Purpose prose in two specs: no requirement or scenario text changed and nothing a user can see. No `frontend/**`, `schemas/**` or `ApiRoutes.scala` change (`git diff --name-only` checked). The orchestrator also said UI does not apply to this backend-only change. I started no servers and made no live probe.

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/services/pipelines/Hel1503EditorRunGapsSpec.scala:93`: add `import slick.dbio.DBIO` to the top-level imports and change the signature to `private def priv[T](a: DBIO[T]): T`.
2. `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala:111-123`: rewrite the numbered steps in the `insertRunIfUnderConcurrencyCap` scaladoc to match the code. The steps are: (1) `keyShareOwnerAction`, the row read `FOR KEY SHARE` (absent gives `PipelineGone`, another owner gives `NotAuthorized`); (2) the owner-keyed advisory lock; (3) count and insert. Remove the `pipelineOwnedAction` reference.
3. `PipelineRunRepository.scala:203-207`: in the grantee scaladoc, make step (1) say the owner id is read `FOR KEY SHARE` (absent gives `PipelineGone`). Make step (3) say only that a revoked grant yields `NotAuthorized`, and drop "or a pipeline deleted since".
4. `backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala:176`: remove ", or the pipeline deleted mid-submit" from the `NotAuthorized` arm comment.
5. `PipelineRunExecutor.scala:151-153`: replace "dry runs skip this call entirely (already covered by the rate limit above) and proceed straight to `backend.execute`". It should say that dry runs skip admission but are re-verified by `checkRunAuthorizationInternal` (HEL-1503 D4) before executing.

These are comment and import edits only, so no behaviour changes. After them, re-run `testOnly Hel1503EditorRunGapsSpec` and `check:scala-quality` (a full `testFull` is not needed for comment-only edits).

### Non-blocking Suggestions
- `PipelineRunRepository.scala` owner path: `rowOwner.toString != user.id.value` compares strings. The `pipelineOwnedAction` it replaced compared UUIDs. Ids come from the DB in lowercase, so this is fine today, but `rowOwner != UUID.fromString(user.id.value)` would match the old semantics exactly.
- `PipelineRunRepository.scala:207` and the `ConcurrencyCapResult` scaladoc lines added by this diff run well past the surrounding wrap width. Re-wrap them when fixing CR 3.
- `Hel1503EditorRunGapsSpec.scala` is 375 lines (soft budget 250, warning only).
- `files-modified.md` meets the format: bulleted, backticked, repo-relative, one per line.
