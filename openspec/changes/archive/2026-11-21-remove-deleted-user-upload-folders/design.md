## Context

See proposal.md (Why). Ground truth the plan rests on (premise-validation.md in the run evidence):

- `AssistantConversationService.blobPath` writes `assistant-conversations/<userId>/<conversationId>.json`.
- V132 `hel1530_enqueue_conversation_object` queues `gcs_body_ref` on every `assistant_conversations` row delete
  (including the explicit child delete in `buildUserDeleteSql`), and `StoredObjectDeletionService` drains it on the
  scheduler tick via `FileSystem.delete`.
- `LocalFileSystem.delete` is `Files.deleteIfExists(resolve(path))`: the file goes, `<userId>/` stays. 297 of the
  owner's 331 folders are empty for exactly this reason; the other 34 hold files whose queue row died with a dropped
  lane DB, was drained against another root, or predates V132 (no backfill, HEL-1529).
- Production has no account deletion: no route or service deletes a `users` row (`docs/user-reference-inventory.md`).
  Prod storage is GCS (`HELIO_UPLOADS_BACKEND=gcs`), which has no directories, so the folder residue is local-only.
- Every other upload family (`csv/`, `text/`, `pdf/`, `image/`, `images/`, `form-uploads/`) is flat, object-id keyed.

## Goals / Non-Goals

Goals: no `<userId>/` folder survives its last conversation's drain; test-user cleanup removes the folder even when no
drain will ever run; a safe tool for the existing residue. Non-goals: see proposal.md; also no change to the queue,
triggers, `GcsFileSystem`, or the `FileSystem` trait's signature.

## Decisions

**D1. `LocalFileSystem.delete` prunes the directories it empties, bounded below the family directory.** After the
file delete (whether or not the file existed, so a re-drained or already-missing key still clears an empty folder), walk from the file's parent upward while the directory is strictly deeper than `baseDir/<first segment>`,
calling `Files.delete(dir)`; stop on `DirectoryNotEmptyException` or `NoSuchFileException` (both expected, swallowed);
any other IOException is logged at WARN by class and does not fail the delete (the object itself is gone, which is
the contract the drain dequeues on). `baseDir` and the family directory are never deleted. A path that normalizes
outside `baseDir` is not walked. Alternative rejected: pruning in `StoredObjectDeletionService` (the drain would need
to know local layout; GCS has no directories) or in `AssistantConversationService` (misses the drain and SQL paths).

**D1a. `LocalFileSystem.write` survives the race with D1.** `write` does `createDirectories(parent)` then
`createTempFile(parent, ...)`; a concurrent prune can remove `parent` between them. Wrap that pair in a bounded retry
(up to 3 attempts) on `NoSuchFileException` only. Once the temp file exists the directory is non-empty, so the prune's
`Files.delete` cannot remove it and `ATOMIC_MOVE` stays same-directory. A deterministic test injects the removal
between the two calls (a package-private hook or a subclass seam; the executor picks the smallest one) and fails on
current code with no retry.

**D2. Test-user cleanup removes the exact folder after commit.** `userCleanupCore.cjs` gains a pure path builder
`conversationFolderPaths(records, uploadsRoot)` (reuses `validateRecords`, so only validated UUIDs reach a path; returns
`join(root, "assistant-conversations", id)` per record) and `resolveUploadsRoot(processEnv, dotEnv, homedir)`. The dev
backend sees `DevEnv.runEnv(parseDotEnv(backend/.env), sys.env)` (`backend/build.sbt:152`,
`backend/project/DevEnv.scala`): a shell-exported key wins, `backend/.env` fills missing keys. So the resolver merges
the same way: for each of `HELIO_UPLOADS_ROOT`, then `HELIO_UPLOADS_DIR`, take the process value else the `.env`
value; else `~/.helio/uploads`; absolute + normalized. The `.env` map comes from `db.cjs`'s existing `readEnvFile`
(exported for reuse), and no value is ever printed. All three repo callers of `buildUserDeleteSql`
(`e2e/support/userCleanup.ts deleteRecordedUsers`, `helio-mcp/scripts/layoutPreconditionSeam.ts`,
`scripts/landing-captures/run.mjs`) go through one shared helper in `userCleanupCore.cjs`/`db.cjs` that calls
`psql(buildUserDeleteSql(...))` first and then `rmSync(path, {recursive: true, force: true})` for each built path; psql throws on an aborted transaction, so a
failed delete removes nothing. Why both D1 and D2: D1 needs a backend draining against the same root; a lane DB is
dropped at Delivery, often before a tick, so D2 is what makes test cleanup deterministic. A symlinked folder: check
`lstatSync` and refuse (skip with a warning) rather than follow. The helper logs one line of numbers only
(`removed N of M conversation folders`), never a path or id, so a root mismatch is visible as `removed 0`. The
seam and landing-captures users never create a conversation, so for them the removal is a no-op in practice; they
are wired anyway so the spec's "every caller" holds and a future conversation-creating flow is covered.

**D3. Prune script `scripts/prune-orphan-conversation-folders.mjs` + `.selftest.mjs`.** CLI: `--uploads-root <abs>`
(required), `--database-url <url>` (repeatable, at least one; jdbc: prefix accepted, passed to psql via argv/env as
`e2e/support/db.cjs` does, never printed; errors scrubbed with the same `scrubSecrets` approach), `--delete` (opt-in),
`--summary` (print counts only). Steps: read direct children of `<root>/assistant-conversations` with
`withFileTypes`; keep real directories (not symlinks) whose name matches the strict UUID regex, count the rest as
skipped; for each database run one `SELECT id::text FROM users WHERE id = ANY('{...}'::uuid[])` built only from the
validated UUIDs; a query failure aborts with exit 1 and nothing listed; orphans = UUIDs in no result. Dry run prints
each orphan path and a final `orphans=N kept=M skipped=K deleted=0` line. With `--delete`, `rmSync` each exact path
built by `join`, never a glob. Core logic is a pure exported function with the DB query and fs injected, so the selftest
runs against a temp dir and a fake query with no database; the evaluator runs it once live against the lane DB.
Wired into package.json (`check:prune-orphan-conversations:selftest`), `.husky/pre-commit` next to the
e2e-user-cleanup selftests, and the same `npm run` line in `.github/workflows/ci.yml` next to the existing
user-cleanup selftests (`check-precommit-ci-parity.mjs` fails CI otherwise).

**D4. Documentation.** `docs/user-reference-inventory.md` storage-blobs bullet gains the conversation-folder note and
the prune script; the PR body states production account-deletion behaviour (none; any users delete queues every blob
family; GCS leaves no folder). `MISTAKES.md` is not edited unless a reviewer finds a trap worth one.

**D5. Concertino lane cleanup is out of scope** (rendered + gitignored here, C-rule); raised at Delivery as a
follow-up triage (CON), tracked in workflow-state `FOLLOWUPS`. Users created in a lane DB outside the e2e registry
(a manual evaluator signup) are covered only by the prune script. Running the prune with `--delete` on the owner's root is the owner's call.

## Risks / Trade-offs

- [A prune races a live conversation create] → D1a retry; the prune never removes a non-empty directory.
- [Teardown resolves a different root than the server] → the resolver merges process env over `backend/.env` exactly
  as the dev backend does. Lane tooling (`start-servers.sh`) sets no uploads root, so a lane's server and teardown both
  fall to the same `.env`/home default unless the caller exports one for both; this run's own lane exports a
  lane-private `HELIO_UPLOADS_ROOT` to the server and to every Playwright/cleanup run. A residual mismatch (e.g. a
  remote `BASE_URL` server) is a no-op `rmSync` on a nonexistent exact path, made visible by the `removed 0` count.
- [Prune deletes a live lane's users' folders when a lane DB is not passed] → dry run default; the script's usage text
  and docs say to pass every live database; the owner runs `--delete`.
- [Owner's home] → no agent runs `--delete` against `~`; tests use temp dirs only.

## Migration Plan

None (no schema change). Rollback is a revert.

## Planner Notes

- Self-approved: prune script lives in `scripts/` (tracked, alongside other `.mjs` tools), not `scripts/concertino/`.
- Self-approved: only `assistant-conversations/` gets folder handling; other families are flat (verified on disk).
- No escalation: production has no account deletion, so there is no prod deletion defect to escalate; the absence of
  the feature is stated in the PR, not built here.

## Gate-Chain Implications Checklist

`.husky/pre-commit` gains one line, `npm run check:prune-orphan-conversations:selftest`, beside the existing e2e-user-cleanup selftests.

- **What does it execute?** `node scripts/prune-orphan-conversation-folders.selftest.mjs`: it imports the prune module and runs its pure core against a `mkdtemp` directory with injected fake queries, plus four CLI cases against an unreachable database URL on port 1 that exit non-zero before any listing.
- **What environment does it inherit, and from where?** Git's hook environment (possibly `GIT_DIR`/`GIT_WORK_TREE` from a linked worktree) and the shell's. It reads no `.env` and no database; the CLI cases pass only `PGCONNECT_TIMEOUT`, and nothing it runs consults git.
- **Does it write anything outside its own sandbox?** No. It creates and removes only its own `os.tmpdir()` directories (a root, and a symlink target outside it) and never touches the worktree, the index or the home directory.
- **Does it behave differently from a linked worktree than from a main checkout?** No: all paths derive from `import.meta.url` for the script and from `mkdtemp` for data, and the isolation transcript shows the same pass under a hook-shaped environment.
- **What happens on its first run?** It passes with 14 checks; with no cache or state to warm, and the only slow path (the unreachable-database cases) bounded by `PGCONNECT_TIMEOUT=3`.
