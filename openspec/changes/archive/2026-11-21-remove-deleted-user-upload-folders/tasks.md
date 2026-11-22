## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; no env-dumping commands; never copy a tree containing one.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs; stop servers with stop-servers.sh; delete DB residue only via buildUserDeleteSql by exact id.
- [C4] jest 3 workers, Playwright 2 workers total, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in small shards (testOnly per spec); nothing running past the tool timeout.
- [C6] Never modify anything under ~ (incl. ~/.helio/uploads); never run the prune with --delete outside a temp dir; tests use temp dirs only.
- [C7] Lane DB helio_hel1802 and a lane-private HELIO_UPLOADS_ROOT for any server or e2e run; ANTHROPIC_API_KEY exported empty.
- [C8] Red first: record and COMMIT the red run (as .txt) before implementation code; mutations prove each guard.

## 1. Red first

- [x] 1.1 Add the drain integration test (user with a conversation deleted by the explicit `DELETE FROM assistant_conversations WHERE owner_id=...` then `DELETE FROM users` the builder emits, drain pass over LocalFileSystem in a temp dir: no file, no `<userId>/` folder, family dir kept) and LocalFileSystemSpec cases (sibling kept, flat family kept, write-vs-prune race); run, commit red output as .txt
- [x] 1.2 Add userCleanup selftest cases for the folder path builder and root resolution (.env-only HELIO_UPLOADS_ROOT honoured; process env overrides .env; HELIO_UPLOADS_DIR fallback; home default) and the prune selftest; run, commit red output as .txt

## 2. Backend

- [x] 2.1 LocalFileSystem.delete prunes emptied directories below the family directory (D1); verify 1.1 green
- [x] 2.2 LocalFileSystem.write retries the createDirectories/createTempFile pair on NoSuchFileException (D1a); verify the race case green

## 3. Scripts

- [x] 3.1 userCleanupCore.cjs: resolveUploadsRoot + conversationFolderPaths + shared delete-then-remove helper with a numbers-only log; wire userCleanup.ts, helio-mcp layoutPreconditionSeam.ts and scripts/landing-captures/run.mjs (D2); verify 1.2 green
- [x] 3.2 scripts/prune-orphan-conversation-folders.mjs (D3), package.json script, .husky/pre-commit and .github/workflows/ci.yml wiring; verify selftest green and check-precommit-ci-parity passes

## 4. Docs

- [x] 4.1 docs/user-reference-inventory.md storage-blobs bullet: conversation folders + prune script usage (D4); verify the V119 inventory spec still parses it

## 5. Tests

- [x] 5.1 Mutation runs: revert each guard (D1 prune, D1 family bound, D1a retry, D2 post-commit ordering, D3 dry-run default, D3 fail-closed DB) and record each going red; commit the transcript as .txt
- [x] 5.2 Full spec files: LocalFileSystemSpec, the new drain spec, FormAndConversationObjectDrainSpec, StoredObjectDeletionServiceSpec, LocalFileSystem-dependent specs (sbt testOnly shards), all touched selftests, lint/typecheck
- [x] 5.3 Live: prune dry run against a temp root and lane DB helio_hel1802 (one present user, one absent), showing listed orphan and an unchanged tree checksum before/after
