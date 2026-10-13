## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 4d3755079f642726a04dd54edc413c9146429d3a (planning artifacts untracked in the worktree).

### What I verified (with evidence)

- **Inventory (AC1), mostly correct.**
  - `DataSourceService.deleteAfterPrecheck` deletes the file before `dataSourceRepo.delete`. Confirmed at `DataSourceService.scala:709-722`. The P0001 recover follows at :725.
  - `DataSourceRepository.delete` runs under `withUserContext` (`DataSourceRepository.scala:263-264`).
  - `ImageUploadRepository` has no delete. The only raw `DELETE FROM users` outside migrations is `e2e/support/userCleanupCore.cjs:110`.
  - `FirstRunDashboardService.scala:46` rolls back through `dataSourceService.delete`, so the service path covers it.
  - `WorkspaceTeardownRepository.scala:155` deletes sources; post-commit file cleanup is claimed in the premise. I did not re-verify it, but it is not load-bearing for the trigger design.
  - The create-side write-then-insert with no compensation is confirmed at `ImageUploadService.scala:78-83` and `AssistantConversationService` `create`.
- **Key extraction is feasible.**
  - `data_sources.config` is JSONB (V33 `ALTER COLUMN config TYPE JSONB`).
  - `source_type` literals are `csv`/`text`/`pdf`/`image` (V106 CHECK, line 140).
  - Paths are `csv/<id>.csv`, `text/<id>.<ext>`, `pdf/<id>.<ext>` and `image/<id>.<ext>` (`DataSourceService.scala:298,367,448,541,623`). `image_uploads.storage_key` is `images/<uuid>.<ext>` (V54, `ImageUploadService.scala:67`).
  - **But** `DataSourceConfigCodec.decodeCsv` falls back to a legacy `filePath` key (HEL-237). No migration ever rewrote `filePath` to `path` (zero hits for `filePath` in `db/migration`). See CR1.
- **No key sharing between rows in practice.** Every file-backed creator uses fresh ids, and FirstRun templates go through `createCsv`. There is a non-owning reference, though: an image source's `config.path` is copied as `storageKey` into pipeline row content and `binary_refs` (`InProcessPipelineEngine.scala:761-768`). The drain's shared-key guard does not see it. This matches today's eager delete in `DataSourceService.delete`, so it is not a regression, but the Goals sentence "nothing that is still referenced ... is ever removed" overclaims. See the notes.
- **In-flight safety.** The queue only ever holds keys of rows whose delete committed, and every key is a fresh id. The claim holds by construction.
  - Residual: a concurrent refresh write-back to `config.path` (`DataSourceService.scala:1176`, `InProcessPipelineEngine.scala:628`) racing a delete can re-create the object after the drain. That is a leak, not unsafe.
- **Pools and roles.**
  - `withSystemContext` uses the privileged pool, `SET ROLE helio_privileged` with BYPASSRLS (`DbContext.scala:18-64`, V34).
  - Default privileges for new tables come from V38 `ALTER DEFAULT PRIVILEGES`.
  - The scheduler tick's existing passes (`PipelineSchedulerService.scala:107-142`) are nullable/never-fail. The design's "same privileged access" is consistent with this.
- **RLS posture: under-specified, with misleading precedents.** See CR2.
- **Storage delete idempotence confirmed.** `LocalFileSystem.delete` uses `Files.deleteIfExists`. `GcsFileSystem.delete` calls `storage.delete` and ignores the boolean.
- **Harness exists:** `VerifiedEmbeddedPostgres`, `GcsFileSystemSpec`, `ScalaTestSummaryGuardSpec` (hel1468 guard), and `V119OwnerFkMigrationSpec`/`FlywayNonSuperuserMigrationSpec` (NOBYPASSRLS precedents).
- **Migration number.** V126 is the latest, so V127 is free.
- **Doc line** confirmed at `docs/user-reference-inventory.md:88`.
- **Alternatives.** Trigger queue versus bucket sweep: the rejection reasoning is sound. A sweep needs an age window and would immediately act on historic prod orphans, which belong to the owner.

### Verdict: REFUTE

These are small, specific revisions to design.md and tasks.md. The overall approach is sound.

### Change Requests

1. **Legacy `filePath` key (design.md Decision 1, Decision 2 step 2; spec Requirement 1).**
   - The trigger keys only on `config ->> 'path'`, but `DataSourceConfigCodec.decodeCsv` (`DataSourceConfigCodec.scala:30-37`) still reads legacy CSV configs stored under `filePath`, and no migration ever normalized them.
   - As written, deleting a legacy CSV source enqueues nothing (a leak). The drain's "still referenced" guard would also miss a surviving legacy row.
   - Specify `COALESCE(NULLIF(config->>'path',''), NULLIF(config->>'filePath',''))` in both the trigger and the guard.
   - Add a Decision 6 case: a legacy `{"filePath": ...}` CSV row is deleted and its object is removed. It must be red on a `path`-only mutation.
   - Decision 4's dev measurement should also count rows that have `filePath` and no `path`.
2. **RLS posture (Decision 1 "RLS" paragraph, Decision 6, tasks C2).**
   - Remove `pipeline_auto_run_debounce` / `pipeline_run_rate_window` as acceptable precedents. Both are FORCE-RLS tables whose policies are keyed on `current_setting('app.current_user_id')`. A trigger INSERT into a queue shaped like either one fails or is filtered on the service path. Its behaviour inside the users cascade also differs, because RI cascade actions run as the referencing table's owner with FORCE RLS suspended. Either outcome can abort the user's own `DELETE`, a far worse failure than the leak this ticket fixes.
   - Name the posture: a `SECURITY DEFINER` trigger function with a pinned `search_path` and `SET row_security = off`, re-owned to `helio_privileged` with V100/V122's exact bracket. The queue table is ENABLE+FORCE RLS with no policy, so it is reachable only through the definer function and the privileged pool.
   - State that the Decision 6 RLS proof must run as a NOSUPERUSER NOBYPASSRLS role that **owns the tables and ran the migrations**, as prod's `helio` does and as `V119OwnerFkMigrationSpec` does. A non-owner test role exercises different FORCE-RLS and cascade semantics than prod.
   - Add both mutations: (a) dropping `SECURITY DEFINER` / the re-own makes the cascade or service-path case red; (b) the "plain FORCE RLS without a policy" mutation already listed.
   - Also assert that the trigger never makes the outer delete fail in either case. The test must show that the user delete and the source delete commit.
3. **Red must be behavioral, not a compile failure (Decision 6, tasks 2.1).**
   - On the pre-fix tree there is no queue table, repository, or service. A spec that references `StoredObjectDeletionService` cannot compile there, so a "red" saved from it proves nothing.
   - Specify that the red harness drives only pre-existing entry points: raw SQL delete, then one `PipelineSchedulerService` tick (or its existing test seam), then assert the object is absent. That fails as an assertion on the pre-fix tree.
   - Same for `DataSourceService.delete` with a forced row-delete failure: it must be red as "file was deleted".
   - The shared-key guard and the attempts counter need explicit mutations: remove the guard, so the shared-key test goes red; remove the attempts increment, so the failure test goes red.

### Non-blocking notes

- **Goals wording.** Scope the guard claim to "no surviving `image_uploads`/file-backed `data_sources` row". Add a note that `binary_refs`, node snapshots and history payloads hold non-owning copies of image-source keys. These already dangle on the eager service delete today.
- **Claim mechanics.** `FOR UPDATE SKIP LOCKED` held across an async GCS call means a transaction stays open over network I/O. A `claimed_at` lease, like V110 `pipeline_auto_run_debounce.claimed_at`, may fit Slick better. Double processing is harmless either way, because the delete is idempotent.
- **Shared dev DB.** Worktree backends with different `HELIO_UPLOADS_ROOT`s share one dev DB, so whichever backend claims a queue row deletes from its own root and dequeues. The object may survive in another root. This is dev-only and harmless; mention it in measurements.md.
- **Refresh race.** The refresh write-back race above is a residual leak. List it as a known gap.
