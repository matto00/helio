## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `42781fc9fb92049235ff7c19f1a6fa1019769bb0` against the live-resolved base `1f8e762b5b0055a2c1c76eddd47771eeca8823db`
(commits 1221ce959 red, 6d8e6c145 impl, 42781fc9f evidence).

### Phase 1: Spec Review — PASS
- AC1 (a test that fails on current code: deleting a user who has a conversation leaves no folder): the
  `FormAndConversationObjectDrainSpec` case "a deleted user's conversation folder (HEL-1802)" runs the builder's explicit
  child delete, then the `users` delete, then a drain pass. It asserts that the file and `<userId>/` are gone and that the
  family dir is kept. It was committed in the red commit, and red-scala.txt shows it FAILED against main's
  `deleteIfExists`.
- AC2 (the dry run lists orphans and changes nothing): verified live by me (below), and the selftest covers it.
- AC3 (the production account-deletion behaviour is documented in the PR): the PR is not open yet. proposal.md and design
  D4 commit to stating it ("there is none; any users delete queues every blob; GCS leaves no folder"), and
  docs/user-reference-inventory.md already says "Production has no account deletion". The auditor/delivery must confirm
  that the PR body carries it.
- Ticket "Do" items: production deletion was checked (premise validation: no route deletes a `users` row). All three
  in-repo `buildUserDeleteSql` callers are rewired through `deleteUsersAndFolders`. The concertino lane cleanup was
  deliberately split to a CON follow-up (rendered/gitignored here; recorded in workflow-state FOLLOWUPS). The ticket text
  says "fix it or split it out", so this split is not a reinterpretation.
- Prune requirements: lists only UUID-named real directories present in no given DB. Deletes only with `--delete`
  (`rmSync` is reachable solely inside `if (doDelete)`). Selects by an exact join of root + family + UUID, never a glob.
- tasks.md: every task is [x] and matches the diff. No scope creep. No API/schema change, so no contract updates are
  needed. Planning artifacts match the implementation. workflow-state CONSTRAINTS is `[]`.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH. No `frontend/**` files changed. The root JS/TS checks were run because e2e/,
scripts/ and helio-mcp/ changed.
- `npm run lint` exit 0; `npm run format:check` exit 0 (plus an explicit prettier --check on every touched file: clean)
- `typecheck`, `check:e2e-types`, `check:helio-mcp-types`: exit 0
- `check:prune-orphan-conversations:selftest` 14/14; `check:e2e-user-cleanup-core:selftest` 54/54;
  `check:e2e-user-cleanup` clean; `check:e2e-user-cleanup:selftest` 11/11
- `check-precommit-ci-parity.mjs` OK (the new hook line is covered by ci.yml); `check:scala-quality` clean (soft warnings
  only); `check:no-credential-leak`, `check:openspec`, `check:test-temp-dir-hygiene`, `check:repo-integrity`: exit 0
- Backend (`backend/**` changed). `sbt testFull` was run as testOnly shards per standing constraint C5, at -J-Xmx3g and
  nice 19:
  - LocalFileSystemSpec + FormAndConversationObjectDrainSpec: 45/45
  - StoredObjectDeletionServiceSpec, StoredObjectDeletionRearmSpec, StoredObjectOrderingSpec,
    PipelineSchedulerServiceStoredObjectDrainSpec, AssistantConversationServiceSpec, DataSourceCreateFailureCleanupSpec:
    68/68
  - UploadRoutesSpec, AssistantConversationRoutesSpec, DataSourceServiceSpec,
    FormAndConversationObjectDeletionsMigrationSpec: 107/107
  - The rest of the ~150 LocalFileSystem-touching specs were not run. The behaviour change (delete also removes emptied
    sub-family dirs) is confined to `delete`, and the shards above cover every drain and upload path.

Orchestrator check points:
- (a) Live dry run on a real schema. I re-ran it against a fresh `helio_hel1802` with the exact Flyway DDL of
  `V6__users.sql`. The query reads only `users.id` (UUID PK), and no migration adds RLS or alters `users.id`
  (grep-verified), so a full migrate would not change the result. The temp root held one present user, one absent user,
  a non-UUID dir and a UUID-named symlink to a sibling family.
  - Dry run: listed exactly the absent folder, `orphans=1 kept=1 skipped=2 deleted=0`. The tree checksum (path, type,
    size) was identical before and after (`44ea3481...`).
  - Adding an unreachable second DB: exit 1, nothing listed, checksum unchanged (fail-closed).
  - `--delete --summary` (temp dir only): removed only the orphan. The present user's folder, the non-UUID dir, the
    symlink and its target were all intact.
  - Lane DB dropped and scratch removed afterwards.
- (b) The `beforeStage` seam is acceptable. It is a `private[storage]` no-op whose purpose is documented, with in-repo
  precedent (`RegexTimeBox` "Test seam (D4)", `DraftSaveHooks`). CONTRIBUTING.md has no rule against seams, and design D1a
  explicitly allows "a package-private hook or a subclass seam".
- (c) The userCleanup selftest landed in the impl commit because it is pre-commit-wired and would block a red commit. Its
  red run is committed as red-userCleanup-selftest.txt, and the commit message says so. The prune selftest itself was in
  the red commit. Acceptable.
- (d) The race test is deterministic. The override deletes the directory synchronously between `createDirectories` and
  `createTempFile` on the first attempt only (counter asserted `== 1`), so attempt 1 always throws
  `NoSuchFileException` and attempt 2 always succeeds. No timing is involved. Mutation M3 (single attempt) goes red.
- (e) No home paths or credentials are printed:
  - Teardown logs `label: removed N of M conversation folders` only. The selftest asserts there is no `/` and no id in
    the line.
  - The prune's `--summary` is counts only. The default dry run prints full orphan paths by design (AC: "lists the
    orphans"), so an operator running it on `~/.helio/uploads` will see home paths; use `--summary` when only counts are
    wanted.
  - The connection string is scrubbed from errors: the selftest asserts this, and my port-1 run printed no URL.
- Mutations M1–M6 in mutations.txt each go red on the guard they target. I did not re-run them (doing so would modify
  code). The red-commit transcript independently shows the D1 and D1a tests red against main.

Code quality: imports at top (no inline FQNs). The walk is bounded strictly below `baseDir/<family>` and needs at least
three path segments, so a flat family and the root are never removed. A path normalizing outside `baseDir` is not
walked. Unexpected IOExceptions are logged by class only and never fail the delete. JS deps are injectable, the failed
psql path removes nothing, and symlinks are skipped via lstat. No dead code, TODOs or untyped escape hatches.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The change's own delta specs are under
openspec/changes, which is not a trigger.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` is now 442 lines. It crossed the
  ~400-line point in this change, so per CONTRIBUTING.md line 24 the PR description should propose a split (for example,
  move the HEL-1802 pruning block into its own spec).
- `e2e/support/userCleanupRun.cjs:47-53`: if `rmSync` throws after the DB commit, `deleteRecordedUsers`
  (`e2e/support/userCleanup.ts:79`) throws before removing the registry dir. A rerun would then hit the
  `matched <> n` guard. Consider catching per-folder removal errors into the count (`removed N of M`) rather than
  aborting teardown.
- `scripts/prune-orphan-conversation-folders.mjs:99`: `databaseQuery` passes `env: process.env` and the URL only. Unlike
  `dbConnection()`, it does not map `DB_USER`/`DB_PASSWORD` to `PGUSER`/`PGPASSWORD`. That is fine for local trust auth,
  but worth one line in the usage text: credentials must be in the URL or the PG* env.
- The LocalFileSystemSpec "not walk a path that normalizes outside the root" case is a guard rather than a red-proven
  test: it passes on main too. Label it as such or pair it with a mutation.
- PR body: state the production account-deletion behaviour explicitly (AC3) and name the CON follow-up for the lane
  cleanup.
