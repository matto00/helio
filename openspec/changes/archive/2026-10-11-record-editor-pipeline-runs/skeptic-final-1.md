## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `67e6f5eaf57256bbaecd0f42e43ff1a7a9b1886e`. The review base was resolved live with `resolve-review-base.sh` and came back as `5a53d24b9`. Backend-only change, so there is no UI to judge.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/editor-pipeline-runs-unrecorded/HEL-1492`.
- **V124 is the next free number:** I ran `git fetch origin main`. origin/main is at `64e374bb7`, and its highest migration is `V123__strip_existing_ghost_layout_items.sql`. The two commits on origin/main since the base touch none of the files this branch modifies. Their only pipeline-related files are OutputConfigValidation, OutputFormatVocabulary and frontend.
- **V124 is safe under Flyway's non-BYPASSRLS role:**
  - The migration is a single `ALTER TABLE pipeline_runs ADD COLUMN triggered_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`. It has no UPDATE, no backfill and no default. It is DDL only, so no RLS-filtered data write.
  - There is precedent for a SET NULL FK on this same table: V74's `triggered_by_token_id`.
  - `PipelineRunEditorPersistenceSpec.beforeAll` runs `Flyway.migrate()` as `helio_migration_test` (NOSUPERUSER, NOBYPASSRLS, owns schema `public`), and the spec passed in my run.
- **No privileged write is reachable by a non-owner/non-editor:**
  - Grepping every caller of `executeRun`/`runPipeline`/`insertGranteeRunIfUnderOwnerCap`/`insertGranteeDryRun`/`*Internal` shows that the only route into `executeRun` is `PipelineRunService.submit`. Its flow is:
    - `findByIdShared(.., Some(user))`: no access gives 404.
    - Non-owner: `findGrantRole == Some("editor")`, otherwise 403.
    - Scheduler, auto-run, hook and proposal paths all go through `submit`.
  - Inside the privileged transaction, `insertGranteeRunIfUnderOwnerCap` takes the owner-keyed lock and then re-checks owner-or-editor with `submitterMayRunAction`, which queries `resource_permissions` `role = 'editor'` in the same transaction. Any other result is `NotAuthorized`, and `PipelineRunExecutor` maps it to `Forbidden` before execution.
  - `insertGranteeDryRun` re-checks in the same way and writes nothing if the check fails.
  - `NotOwned` is gone. The only reference left is a comment.
- **A run row can't be left non-terminal:**
  - Every terminal site on the editor path uses `updateRunTerminalInternal`/`updateLastRunInternal` with no re-authorization. Those sites are failure, blocked, write-back `Left`, write-back exception, and success (`writeTerminal`/`writeLastRun` in `PipelineRunTerminalWrites.scala`, used by `PipelineRunSucceededWrites`).
  - The test "admitted editor run whose grant is revoked mid-run" reaches `succeeded`.
  - The owner path still uses the user-scoped methods (`updateRunTerminal`/`updateLastRun` → same columns, same values), so it is unchanged.
- **The owner-keyed lock and count do serialize owner and editor submits:**
  - The lock key is `"pipeline-run-concurrency:" + id`.
    - Owner path: `user.id.value`, reached only when `pipeline.ownerId == user.id`.
    - Grantee path: `ownerUuid.toString`.
  - Both are lowercase UUID strings: `AuthenticatedUser` ids come from `uid.toString` in `UserSessionRepository`/`ApiTokenRepository`.
  - `pg_advisory_xact_lock` is database-wide, so the privileged pool and the app pool contend on it. Both pools run `.transactionally` (`DbContext`).
  - Both paths use the shared `countAndInsertAction(ownerUuid, ...)`, which runs the same non-terminal count over the owner's pipelines.
  - The held-lock test, plus the mutation runs (`HEL-1492-mutation-submitter-keyed-lock-run.txt` and `-submitter-keyed-count-run.txt`, failed=1 and failed=3), show that the guards fail when the key or count is switched to the submitter.
- **Owner-run semantics are otherwise unchanged:**
  - The owner arm calls `insertRunIfUnderConcurrencyCap` with the same lock, ownership check and count. The only additions are the attribution column and `NotAuthorized` (previously `NotOwned`, which executed the run) for a pipeline deleted mid-submit.
  - `updateLastRunInternal` writes the same 5 columns, including `updated_at`, as owner `updateLastRun`.
  - Retention: owner `deleteOldRuns` delegates to `deleteOldRunsInternal` after its ownership check, so editor retention matches it.
- **Each AC traced to code and tests:**
  - Editor success: run row, assertions, `last_run_*`.
  - Failure, blocked, write-back `Left`/exception: terminal `failed`.
  - Cap: 429 with `Retry-After` 15 and 0 executions; an in-flight editor run holds the owner's slot.
  - Editor dry run: writes a row, leaves `last_run_*` untouched, not capped.
  - Attribution: owner, editor, scheduled, unrunnable and hook-token user (`HookRoutesSpec`).
  - Viewer gets 403 and a non-grantee gets 404, with no writes.
  - A grant revoked before admission gets 403 with no execution.
  - Retention: 10 real runs and 10 dry runs are kept.
  - The CLAUDE.md row is updated.
  - The column is not exposed in any API: grepping `backend/src/main` and `schemas` finds no JSON format or schema reference.
- **Red-first evidence:** `HEL-1492-red-run.txt` shows the editor-persistence tests FAILED against unchanged code. There are 16 mutation runs, each with a `[hel1468-guard] failed>=1` line.
- **Gates re-run by me at HEAD:**
  - Command: `nice -n 19 sbt -J-Xmx3g --client "testOnly PipelineRunEditorPersistenceSpec PipelineRunGuardIntegrationSpec PipelineRunRepositorySpec PipelineRunServiceSpec HookRoutesSpec ExistenceNotLeakedRoutesSpec"`, exit 0.
  - Output: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` and `Tests: succeeded 230, failed 0`.
  - I shut the sbt server down afterwards (`sbt --client shutdown` → disconnected).
  - I relied on the full-suite runs (`HEL-1492-testFull-final.txt` and `HEL-1492-evaluator-1-testFull.txt`: guard failed=0, 6985 succeeded) without re-running them. The pasted output is unambiguous, and HEAD's only commit after those runs (`67e6f5eaf`) touches docs and openspec only, no Scala.

### Verdict: CONFIRM

### Non-blocking notes

- For an owner whose pipeline is deleted between `submit`'s lookup and admission, the response is now 403 rather than the old silent unrecorded run. This is narrow, documented in the `ExistenceNotLeakedRoutesSpec` allowlist, and leaks nothing, but 404 would arguably be a better fit for "gone".
- `insertGranteeRunIfUnderOwnerCap` reads `owner_id` before it takes the lock. That only matters if pipeline ownership can change, and I found no ownership-transfer path today.
- A revoked editor's dry run still executes; only its row is suppressed. This is acceptable because `submit`'s ACL check had just passed, and it matches the design.
