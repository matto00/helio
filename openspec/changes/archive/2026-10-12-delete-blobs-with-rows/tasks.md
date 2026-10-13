## Standing Constraints

- [C1] Proof per design.md Decision 6's labels: every [RED-FIRST] item (R1-R6) is shown failing on the pre-fix tree before the fix; every [MUTATION] item (M1-M5) is shown red under its named mutation; [GUARD] items are labelled as guards (G4/G5 also mutation-proved). Red/mutation output saved under the run evidence dir. New specs use `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` appears in every sbt run; sbt runs follow MISTAKES.md (testFull/testOnly with the worktree's own server, `nice -n 19`, HEL-1442 caps, shut down every sbt server started).
- [C2] Every trigger/queue/drain proof that involves RLS runs under a NOSUPERUSER NOBYPASSRLS role (dev/CI superusers mask RLS).
- [C3] No historic orphan is deleted anywhere; measurement is read-only; storage in tests and probes uses a temp uploads root inside the worktree, never `~/.helio/uploads`; never read/print `backend/.env` or an env map.
- [C4] Any live-API probe uses a throwaway `@example.test` user registered by the agent itself (id recorded up front, identity checked via `/api/auth/me`); never matt@helio.dev.
- [C6] Red fails on behaviour only, through existing entry points (raw SQL delete / existing services + one existing `PipelineSchedulerService.tick()`); a compile failure is never a red. RLS proofs run as a NOSUPERUSER NOBYPASSRLS role that owns the tables and ran the migrations (V119OwnerFkMigrationSpec shape); trigger function posture is SECURITY DEFINER + pinned search_path + row_security=off, owned by helio_privileged; queue table FORCE RLS with no policy.
- [C5] No inline FQNs; follow CONTRIBUTING.md; migration number re-checked against origin/main before commit.

## 1. Measure (read-only, before any code)

- [x] 1.1 Measure dev orphan objects and missing objects per design.md Decision 4 (include the count of legacy `filePath`-only csv rows); write `measurements.md` in this change with commands and counts.
- [x] 1.2 Add a probe counting queue rows at the attempt cap (stuck rows) to `measurements.md`.
- [x] 1.3 Write the prod read-only SQL + GCS listing procedure into `measurements.md` (owner runs it).

## 2. Red

- [x] 2.1 Write the Decision 6 specs; run them on the pre-fix tree and save the red output.

## 3. Queue and trigger

- [x] 3.1 Add `V128__stored_object_deletions.sql` (table, triggers on `image_uploads` and `data_sources`, RLS posture per Decision 1); migration/trigger spec under a NOSUPERUSER NOBYPASSRLS role.

## 4. Drain

- [x] 4.1 Lift `deleteStoredObject` into a shared helper.
- [x] 4.2 `StoredObjectDeletionRepository` + `StoredObjectDeletionService` (bounded claim, shared-key guard, attempts).
- [x] 4.3 Wire (detached, in-flight guarded, backoff per Decision 2) into `PipelineSchedulerService.runPasses` and `Main.scala` (nullable-optional, never fails the tick); wiring spec W1.

## 5. Delete-path and create-path fixes

- [x] 5.1 `DataSourceService.delete`: object delete after the row delete succeeded.
- [x] 5.2 `ImageUploadService.upload` and `AssistantConversationService.create` compensation.
- [x] 5.3 Probe `PanelFormFileSubmission`; fix if same small shape, else record follow-up evidence.

## 6. Docs and verification

- [x] 6.1 Update `docs/user-reference-inventory.md` ("Not cleaned up" line) and any affected `README.md` in touched packages.
- [x] 6.2 Run all new/affected specs green (local and GCS double); run the pre-commit gates; record `files-modified.md` (bulleted, backticked, repo-relative paths).

## Execution notes (executor)

- Migration number: the shared dev DB already carries V127 (`dashboard layout version`, another lane, not yet on origin/main), so this change ships `V128__stored_object_deletions.sql`. design.md and proposal.md were updated to V128.
- 5.3: `PanelFormFileSubmission` probed red (a refused in-lock append left the stored `form-uploads/` object) and fixed for a returned `Left` only; a FAILED append future is deliberately not compensated (ambiguous: the append may have committed).
