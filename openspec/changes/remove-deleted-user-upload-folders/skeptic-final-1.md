## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `42781fc9fb92049235ff7c19f1a6fa1019769bb0` against the live-resolved base
`1f8e762b5b0055a2c1c76eddd47771eeca8823db` (resolve-review-base.sh, exit 0). Spawn-cwd guard: READY.

### What I verified (with evidence)

- **Diff read in full**: LocalFileSystem.scala (delete prunes emptied dirs strictly below `baseDir/<family>`, only when
  the relative path has >= 3 segments and lies under baseDir; write retries mkdir+createTempFile up to 3 times on
  NoSuchFileException only), the two specs, userCleanupCore/userCleanupRun/userCleanup.ts, the seam and
  landing-captures callers, the prune script and its selftest, hook/CI/package.json wiring, and the docs bullet.
  baseDir from `fromEnv` is `toAbsolutePath.normalize()`, so the `startsWith(baseDir)` test is sound.

- **AC1 (a test failing on base: deleting a user with a conversation leaves no folder)**:
  `FormAndConversationObjectDrainSpec` "a deleted user's conversation folder (HEL-1802)" creates a conversation via a real
  `LocalFileSystem` write + row, deletes `assistant_conversations` then `users`, runs the real
  `StoredObjectDeletionService.runPass`, and asserts the folder is gone and the family dir kept. Red: commit 1221ce959
  changes `backend/src/main` only by the no-op `beforeStage` seam (22-line diff), and the committed red-scala.txt shows
  this test FAILED at `FormAndConversationObjectDrainSpec.scala:211`, which is exactly the `Files.exists(<folder>)
  shouldBe false` line (the file-gone assertion on line 210 passed), so it fails for the right reason. That is also
  logically forced: base `delete` was `Files.deleteIfExists` only.
  Green, fresh by me: `sbt -J-Xmx3g testOnly LocalFileSystemSpec FormAndConversationObjectDrainSpec
  StoredObjectDeletionServiceSpec` -> `Suites: completed 3, aborted 0 / Tests: succeeded 52, failed 0`.

- **AC2 (prune dry run lists orphans, changes nothing)**: code: `rmSync` is reachable only inside `if (doDelete)`, and
  `doDelete` is set only by `--delete`. Live, fresh by me against a temp root under scratch and lane DB `helio_hel1802`
  (users table with one present UUID; folders: present, absent, `not-a-uuid`, plus a flat `images/`):
  - dry run: printed only the absent user's folder, `orphans=1 kept=1 skipped=1 deleted=0 matchedPerDatabase=1`, exit 0;
    tree checksum (path, type, size) before = after = `97b1ea4a...9ac79`.
  - second DB unreachable (`127.0.0.1:1`, with a password in the URL) plus `--delete`: exit 1, the error carried no
    URL or password, all three folders still present.
  - `--delete --summary` (temp dir only): `deleted=1`; present user's folder + file, `not-a-uuid` and `images/` intact.
  `users` has no RLS (only V8 touches it), so a non-privileged role cannot silently see zero users.
  Lane DB dropped and scratch removed afterwards.

- **AC3 (production account-deletion claim)**, checked against the source tree:
  - "No account deletion": no `DELETE FROM users` / user-delete method in `backend/src/main/scala` (the only `delete*`
    in UserRepository is `deleteSession`). True.
  - "Any users delete queues every blob family": the blob families written by `fileSystem.write` callers are `csv/`,
    `text/`, `pdf/`, `image/` (data_sources, V128 trigger), `images/` (image_uploads, V128), `form-uploads/`
    (dataset_rows statement triggers, V132; dataset_rows cascades from data_sources), `assistant-conversations/`
    (V132 row trigger). data_sources and image_uploads cascade from users (V119). True, with one nuance the PR body
    should state precisely: `assistant_conversations.owner_id` is `REFERENCES users(id)` with NO cascade (V80, never
    altered), so a users delete is refused while conversations exist; a successful one must delete them explicitly
    first (as `buildUserDeleteSql` does), and that delete fires the queue trigger.
  - "GCS leaves no folders": `GcsFileSystem.delete` is a single `storage.delete(BlobId)`; GCS has a flat namespace.
    True.

- **Gates re-run fresh by me (all exit 0)**: `check:prune-orphan-conversations:selftest` 14/14,
  `check:e2e-user-cleanup-core:selftest` 54/54, `check:e2e-user-cleanup` clean (218 files),
  `check:e2e-user-cleanup:selftest` 11/11, `check-precommit-ci-parity.mjs` OK, `check:helio-mcp-types`,
  `check:e2e-types`, eslint `--max-warnings=0` on every touched JS/TS file, prettier --check on every touched file.

- **Guard is failable (my own mutation, scratch copy via the selftest's `HEL1802_RUN_PATH` seam, no repo edit)**:
  moving `psql(sql)` after folder removal in userCleanupRun.cjs -> `52 passed, 2 failed` ("psql commits before any
  folder is removed: rm,rm,psql"; "a failed delete removes no folder"). The post-commit ordering is really tested.

- **Ticket "Do" items**: production checked (above); all three in-repo `buildUserDeleteSql` callers route through
  `deleteUsersAndFolders`; the concertino lane cleanup is split to a CON follow-up (rendered/gitignored here, the
  ticket allows "fix it or split it out"); prune lists only UUID-named real directories absent from every given DB,
  deletes only with `--delete`, by exact join, never a pattern.

- **UI**: no `frontend/**` change; step 4 skipped. No servers started.

- No mtime-ordering evidence relied on; the dry-run claim rests on a content checksum.

### Verdict: CONFIRM

### Non-blocking notes

- PR body wording for AC3: say "a successful users delete" and mention that conversations block it (non-cascading FK)
  and must be deleted first, which queues them; do not imply a cascade reaches them.
- A `--database-url` that points at an existing but wrong/empty database makes every folder an orphan;
  `matchedPerDatabase=0` reveals it, but the docs could tell the operator to check that number before `--delete`.
- The uppercase-UUID folder name would be skipped (regex is lowercase); harmless, since Java writes lowercase.
