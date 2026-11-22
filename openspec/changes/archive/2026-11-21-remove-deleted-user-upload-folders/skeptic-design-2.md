## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 1f8e762b5b0055a2c1c76eddd47771eeca8823db. The change dir is still uncommitted.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/remove-deleted-user-upload-folders/HEL-1802`.
- **The orchestrator's claim that `assistant_conversations.owner_id` is NO ACTION:** confirmed from two sources.
  - `V80__assistant_conversations.sql:20` declares `owner_id UUID NOT NULL REFERENCES users(id)` with no ON DELETE
    clause, so it defaults to NO ACTION.
  - `git grep` finds no later migration that changes that constraint.
  - `docs/user-reference-inventory.md:21` lists it as NO ACTION. `V119OwnerFkMigrationSpec` parses that table against
    the live schema.
  - A plain `DELETE FROM users` would therefore fail with 23503. It would not cascade.
- **Task 1.1's fixture matches the builder:** `buildUserDeleteSql` (`e2e/support/userCleanupCore.cjs`) runs
  `DELETE FROM assistant_conversations WHERE owner_id IN (...)` through `BLOCKING_OWNED_TABLES` (line 37). It then
  runs `DELETE FROM users` in a single `BEGIN…COMMIT`. Task 1.1 copies exactly that order, so the round-1 note is
  resolved correctly.
- **Round-1 change request 1 (root resolution):** D2 now merges the two sources per key, with process env first and
  then `backend/.env`. It checks `HELIO_UPLOADS_ROOT`, then `HELIO_UPLOADS_DIR`, then falls back to home. That matches
  `DevEnv.runEnv` and the precedence in `LocalFileSystem.fromEnv`.
  - `readEnvFile` exists in `e2e/support/db.cjs:19` but is not exported yet (`module.exports` at line 81). D2 says
    "exported for reuse", which is consistent.
  - Task 1.2 adds selftest cases for an `.env`-only root, a process-env override, the `DIR` fallback, and the home
    default. Resolved.
- **Round-1 change request 2 (the false mitigation claim):** Risks now say that `start-servers.sh` sets no uploads
  root. My grep of `scripts/concertino/*.sh` for `HELIO_UPLOADS_ROOT` found nothing, so that statement is correct.
  A `removed N of M` log that prints numbers only makes a root mismatch visible. Resolved.
- **Round-1 change request 3 (callers):**
  - All three callers are named in D2 and task 3.1: `userCleanup.ts:78`, `layoutPreconditionSeam.ts:234` and
    `landing-captures/run.mjs:123`.
  - All three already call `psql` from `db.cjs`, so one shared helper can serve them.
  - The spec says "every repository caller", the proposal says "three", and the tasks agree with both. Resolved.
- **Round-1 change request 4 (CI parity):** task 3.2 and the proposal's Impact list now include
  `.github/workflows/ci.yml`. The existing selftests sit at `ci.yml:139-141` and `.husky/pre-commit:25-26`. Resolved.
- **Ordering in D2 (delete first, then remove):** `psql` runs with `-v ON_ERROR_STOP=1` through `execFileSync`. A
  guard `RAISE EXCEPTION` therefore exits non-zero, and `execFileSync` throws before any `rmSync` runs. The "Failed
  delete keeps the folders" scenario is achievable as designed.
- **D1/D1a against `LocalFileSystem.scala`:**
  - `delete` is a bare `deleteIfExists(resolve(path))`.
  - `resolve` is `baseDir.resolve(path).normalize()` with no containment check, so D1's "outside baseDir is not
    walked" guard is needed.
  - `write` runs `createDirectories(parent)` and then `createTempFile(parent, …)`, which is exactly the race window D1a
    names. A directory that holds the temp file cannot be removed by `Files.delete`, so the reasoning holds.
  - The family-dir bound (strictly deeper than `baseDir/<first segment>`) correctly preserves the flat families.
- **Prune script safety:**
  - The `users` table has no RLS. A grep of migrations for `ENABLE ROW` on `users` found nothing, so a non-superuser
    connection cannot silently see zero rows and mark every folder an orphan.
  - A query failure aborts with exit 1, which is fail-closed.
  - Folders are selected by exact UUID, through `join`, with no globs and no symlinks followed.
- **AC coverage:**
  - AC1 is covered by task 1.1 (red first) and the stored-object-lifecycle scenario.
  - AC2 is covered by D3, task 3.2 and task 5.3 (live dry run with a checksum taken before and after).
  - AC3 is covered by D4 (the PR body).
- **No placeholders:** I found no TBD/TODO or deferred decisions.
- **D5:** the deferred work is explicitly scoped out to a CON follow-up tracked in workflow-state.

### Verdict: CONFIRM

### Non-blocking notes

- **Where the shared helper lives.** D2 places the helper in "`userCleanupCore.cjs`/`db.cjs`". The header of
  `userCleanupCore.cjs` says it has "no connection, no filesystem writes", and its purity is what makes it
  unit-testable.
  - Keep the pure parts in the core: `conversationFolderPaths` and `resolveUploadsRoot` with injected env, `.env` map
    and homedir.
  - Put the `psql` + `rmSync` helper in `db.cjs` or a new sibling module, so the core's stated contract stays true.
- **Temp-dir hygiene.** New Scala tests (the drain spec, and the cases in `LocalFileSystemSpec`) must create temp dirs
  through `TempDirectorySupport`. `check:test-temp-dir-hygiene` rejects raw `Files.createTempDirectory`. D1a's
  subclass seam must not call `Files.createTempFile` raw in test code without the reviewed escape.
- **An empty or wrong database.** If the prune runs against a database that has no users at all, every folder is
  listed as an orphan. The dry-run default makes this visible. Consider printing per-database user-match counts (the
  numbers only) in the summary line so this mistake is obvious before anyone passes `--delete`.
- **Callers whose users never converse.** The users of `layoutPreconditionSeam.ts` and `landing-captures` never create
  a conversation, so removing their folders is a no-op in practice. D2 already says so, and that is acceptable.
