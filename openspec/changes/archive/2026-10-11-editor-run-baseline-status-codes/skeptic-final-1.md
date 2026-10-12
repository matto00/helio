## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `2c53d3b5536fbe65da922cf3c599d8bdf4a5cade`. Review base resolved live with
`resolve-review-base.sh` (exit 0): `2e02b79511fab222ac2bc73a142fc61e0979f192`. The spawn-cwd guard printed
`READY ambient=/home/matt/Development/helio branch=bug/editor-run-baseline-statuses/HEL-1503`.

### What I verified (with evidence)

**Diff scope.** `git diff 2e02b795...HEAD --stat` lists 25 files. Six are backend main sources
(`PipelineRepository`, `PipelineRunRepository`, `DataSourceRepository`, `PipelineRunExecutor`, `PipelineRunService`,
`PipelineRunSucceededWrites`) and three are backend tests (the new `Hel1503EditorRunGapsSpec`, an inverted
`PipelineRunEditorPersistenceSpec` case, and `ExistenceNotLeakedRoutesSpec` 1→2). The rest is three synced specs and
the archive. There is no `db/migration` file, no protocol/route/schema file and no `frontend/**` file, so there is no
UI surface and step 4 does not apply.

**AC1: editor baseline.** At `PipelineRunSucceededWrites.scala:252-257` the source is read with
`findByIdOwnedByInternal(sourceDataSourceId, pipelineOwnerId)` on both branches. The write is owner-scoped when
`ownerRun` and goes through `updateLastSourceSchemaInternal` otherwise. `pipelineOwnerId` is `pipeline.ownerId`,
threaded from `executeRunSuccess`, where `pipeline` is the row `submit` read. For owner runs the filter is the same as
before (`id` + `owner_id = owner`), so owner behaviour is unchanged. The dry and failed paths never reach
`onUnblockedRunSuccess`, so they are untouched.

**AC2: 404 boundaries.**
- **Deleted before root resolution:** roots cascade with the pipeline, so `runPipeline`'s empty-roots branch now runs
  `pipelineRepo.findByIdInternal`. A missing pipeline gives `NotFound`; a root-less pipeline still gives 422 (pinned by
  the "keep the 422" case).
- **Deleted after root resolution, real run:** both admission transactions open with
  `SELECT owner_id::text FROM pipelines WHERE id=? FOR KEY SHARE`. An absent row gives `PipelineGone`, which maps to
  `NotFound`.
- **Deleted after root resolution, dry run:** `checkRunAuthorizationInternal` maps `PipelineGone` to `NotFound`.
- **No 5xx:** the key-share lock makes FK 23503 unreachable. A DELETE either commits first (the row is absent) or
  blocks until admission commits.
- **403 only for an existing pipeline:** it is produced only by `NotAuthorized`, and only on an existing row.
- **Delete after the dry-run re-check:** I checked whether this window can still produce a 5xx. The dry-run row write
  in `onDryRunSuccess` is wrapped in `.recoverWith`; the owner's `insertDryRun` no-ops on a missing row and
  `insertGranteeDryRun` no-ops on `None`. No 5xx results. The spec names this window an accepted race, the same as
  real runs after admission.

**AC3: dry-run re-check.** At `PipelineRunExecutor.scala:185-193` the re-check runs for every dry run, after the rate
limit and before the `queued`/`running` publishes and `backend.execute`. It is skipped only when
`pipelineRunRepo == null`, which happens only in fixtures. A revoked editor gets `Forbidden`.

**AC4: spec text.**
- `pipeline-run-guard`: the requirement is renamed to "...the pipeline owner's concurrency cap". The rename moves the
  block to the end of the file; the other blocks are unchanged.
- The guard Purpose now says "per submitter" for the rate limit, which matches `incrementRateIfUnderLimit(user.id, …)`,
  and "owner's budget" for concurrency.
- `pipeline-run-execution` has a written Purpose.
- `grep -c TBD` returns 0 for all three touched specs.
- The new requirements and scenarios match the code paths above, including the `dry_run` row attributed to the editor
  (`insertGranteeDryRun` with `attribution = Some(user.id.value)`).

**AC5: no exposure.** No protocol, route or `JsonProtocols` change; `triggered_by_user_id` stays stored-only.

**AC6, RLS realism of the harness.**
- `Hel1503EditorRunGapsSpec` runs on `VerifiedEmbeddedPostgres.start`. The app pool is
  `helio_migration_test NOSUPERUSER NOBYPASSRLS`, and the privileged pool uses `SET ROLE helio_privileged` (BYPASSRLS).
- The app role owns the tables, but `pipelines` and `pipeline_runs` are `FORCE ROW LEVEL SECURITY` (V35/V94/V98), so
  RLS still applies to it, as it does to prod's owning `helio` role.
- Owner path under RLS: `FOR KEY SHARE` must pass the V39 `pipelines_update` USING policy
  (`owner_id = current_user_id`). It does for the owner, and test (e) exercises that path on this role.

**Privileged-write safety.** Each new `withSystemContext` is keyed on ids that were already authorized:
- `updateLastSourceSchemaInternal`: keyed on `pipelineId`. It is reachable only when `!ownerRun`, i.e. after
  `insertGranteeRunIfUnderOwnerCap` returned `Inserted` with its in-transaction re-authorization.
- `findByIdOwnedByInternal`: a read on the source id from the resolved roots plus the pipeline owner's id from
  `submit`'s row.
- `checkRunAuthorizationInternal`: a read-only predicate on `(pipelineId, submitter)`.
- The grantee admission: already system context, unchanged apart from the row lock.
- `findByIdInternal` in the empty-roots branch: a read-only existence check on the id `submit` just authorized. It is
  documented in the permitted-callers list.

None of these lets a caller who was not authorized write anywhere.

**Red-first evidence.** I read `red-run.md` as a claim. It shows 10 red and 3 labelled pins against the unchanged code,
each red for its stated reason (NULL baseline, 422, 403, dry run executed, no `SQLException`).

**Mutations I re-ran myself** on a scratch `git archive` export of HEAD
(`<scratchpad>/HEL-1503-skeptic/src`), leaving the worktree untouched:
- **M2 (from red-run.md)**, `findByIdOwnedByInternal(..)` changed to `findByIdInternal(sourceDataSourceId)`:
  ```
  [info] - should store what the owner's own run stores when the primary root's source belongs to the editor (the owner cannot see it) *** FAILED ***
  [info]   Some([{"name":"editor_only","type":"string"}]) was not equal to Some([]) (Hel1503EditorRunGapsSpec.scala:218)
  [info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  ```
  This reproduces red-run.md's M2 claim exactly.
- **M8 (new, not in red-run.md)**: on the owner path, take the advisory lock BEFORE `FOR KEY SHARE`, i.e. reverse the
  D3 lock order:
  ```
  [info] - should hold a key-share lock on the pipeline row while the OWNER path waits for the advisory lock *** FAILED ***
  [info]   Expected exception java.sql.SQLException to be thrown, but no exception was thrown (Hel1503EditorRunGapsSpec.scala:324)
  [info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  ```
  Test (e) therefore pins the lock ORDER, not just that a lock exists.
- **Green after reverting:** `diff -r` of the worktree's `backend/src` against the scratch copy is identical. I then ran
  `nice -n 19 sbt -J-Xmx3g "testOnly Hel1503EditorRunGapsSpec PipelineRunEditorPersistenceSpec *PipelineRunRepositorySpec *ExistenceNotLeakedRoutesSpec"`.
  It exited 0:
  ```
  [info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
  [info] Suites: completed 4, aborted 0
  [info] Tests: succeeded 134, failed 0, canceled 0, ignored 0, pending 0
  ```
  MemAvailable was about 50 GB before the run. I shut down my sbt server (`sbt --client shutdown` printed
  "disconnected"). I did not re-run the full suite; I rely on evaluation-2's pasted `testFull` output (7340/0, guard
  line present), which is unambiguous.

**Inverted test.** `PipelineRunEditorPersistenceSpec`'s former "NotAuthorized for a pipeline that no longer exists"
case is inverted to `PipelineGone` on both paths, not deleted. `PipelineRunRepositorySpec:629` (`NotAuthorized` for a
non-owner on the owner path) still holds under its harness, as D3 states.

**Callers of `submit`.**
- Scheduler, auto-run and proposal apply handle any `Left` generically.
- The hook trigger maps any `Left` through.
- The new `PipelineGone` arm is matched in the only `ConcurrencyCapResult` match (`PipelineRunExecutor:168-182`).

**Evidence handling.** No screenshots or mtime-ordering claims are relied on. The mutation evidence above is quoted
log content (self-authenticating).

### Verdict: CONFIRM

### Non-blocking notes
- `checkRunAuthorizationInternal` takes no row lock, so a delete or revoke after it but before execution still lets a
  dry run execute. The spec names this explicitly as an accepted race, and it never 5xxes, because the dry-run row
  write is recovered and no-ops.
- Under production RLS the owner path's `NotAuthorized` arm is effectively unreachable: a non-owner's `FOR KEY SHARE`
  fails `pipelines_update` USING and reads as `PipelineGone`. This is correctly documented in D3 and only matters if an
  ownership-transfer write is ever added.
- Evaluation-2's two cosmetic notes still apply: the comment re-flow at `PipelineRunExecutor.scala:151-154` and the
  long scaladoc line at `PipelineRunRepository.scala:589-591`.
- The worktree has `evaluation-2.md` untracked in the archive dir. This is the orchestrator's housekeeping, not a code
  issue.
