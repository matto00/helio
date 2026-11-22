## Standing Constraints

- [C1] Never read, print, copy or source any `.env` file; never run env-dumping commands. Only `scripts/concertino/.concertino.env` may be read by scripts, never printed.
- [C2] Quoted heredocs only (`<<'EOF'`).
- [C3] No pkill/pgrep/killall; exact PIDs; servers stopped with stop-servers.sh; test residue deleted by exact id with buildUserDeleteSql.
- [C4] jest 3 workers, Playwright 2 workers total, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt in shards that finish under it; no background run past the tool timeout.
- [C6] The owner's home directory (`~`, including `~/.helio/uploads`) is never modified: no prune --delete against it; tests use temp/scratch dirs; any sbt run of the fromEnv suite redirects `user.home` to scratch.
- [C7] Red first with mutations, full spec files; red output committed as `.txt` before implementation; split before-counts committed before the split.
- [C8] All scratch/tool output in the MAIN checkout's `.concertino/scratch/HEL-1817/` (set TMPDIR there for selftests); never /tmp or inside the worktree.
- [C9] Lane-private DB `helio_hel1817` (DATABASE_URL) for anything touching a DB, including commit hooks; ANTHROPIC_API_KEY exported empty for any backend.
- [C10] fromEnv suite user.home redirect only via sbt `set Test / javaOptions += "-Duser.home=<scratch>"` and proven by <scratch>/.helio/uploads existing afterwards; root-resolution-failure test must throw inside the post-commit phase (after psql)

## 1. Red tests (commit before implementation)

- [x] 1.1 In `e2e/support/userCleanup.selftest.mjs` add cases for `deleteRegistryRun` (temp registry dir, fake psql succeeds, fake remove throws for one of two folders): both folders attempted, registry dir gone, throws with a count-only message (no id, no `/`), and a second call on the same dir returns 0 without calling psql; root-resolution failure counts all as failed and still clears the dir; a psql throw keeps the dir and removes nothing; `deleteUsersAndFolders` returns `failed` and its log line has the failed count. Run `node e2e/support/userCleanup.selftest.mjs`, verify it FAILS, commit output as `openspec/changes/harden-user-cleanup-teardown/red-userCleanup-selftest.txt`.
- [x] 1.2 In `scripts/prune-orphan-conversation-folders.selftest.mjs` add the fake-`psql` CLI cases from design Decision 5. Run it, verify FAIL, commit `red-prune-selftest.txt`.
- [x] 1.3 Run `LocalFileSystemSpec` alone via `sbt -J-Xmx3g` testOnly (user.home redirected), record the per-suite test count, commit `split-counts-before.txt`.

## 2. Implementation

- [x] 2.1 `userCleanupRun.cjs`: total post-commit phase, `{removed, failed, total}`, numbers-only log; add `deleteRegistryRun`; `userCleanup.ts` `deleteRecordedUsers` becomes a wrapper. Verify 1.1 cases pass.
- [x] 2.2 `layoutPreconditionSeam.ts` failed-count check; `landing-captures/run.mjs` non-zero exit on failed count. Verify `npm --prefix helio-mcp run typecheck` (or the repo's helio-mcp tsc) passes and grep shows no id/path in the new messages.
- [x] 2.3 `db.cjs` `credentialEnv` extraction; prune `databaseQuery` uses it with env-var credentials and scrubs them. Verify 1.2 cases pass and existing prune/userCleanup selftest cases still pass.
- [x] 2.4 Mutations (record in `mutations.txt`): revert the per-folder catch; move `rmSync(dir)` back after the throw; drop PGPASSWORD mapping; drop credential scrubbing - each must turn a named selftest case red.
- [x] 2.5 Update `e2e/README.md` teardown section (folder failure clears the registry, count-only error, prune script as recovery).

## 3. Split

Note (executor): the core suite alone stayed at 275 lines, so the split is FOUR suites (`LocalFileSystemAtomicWriteSpec` added); all four are under 250.

- [x] 3.1 Split `LocalFileSystemSpec.scala` into `LocalFileSystemSpec`, `LocalFileSystemPruneSpec`, `LocalFileSystemFromEnvSpec` per design Decision 6; update the `ClaudeConfigSpec` comment. Each file under 250 lines.
- [x] 3.2 Run the three suites (user.home redirected), record per-suite counts in `split-counts-after.txt`; the sum equals the before count and every test name is present (diff of sorted names empty).

## 4. Gates

- [x] 4.1 `npm run lint`, `npm run typecheck`, `npm run format:check`, `node scripts/check-scala-quality.mjs` (no soft warning for the split files), both selftests green, commit through the pre-commit hook with DATABASE_URL pointing at `helio_hel1817`.
