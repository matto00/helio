## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `5af3a438c33ce494272162f7d3c1e2df9c6d2c7d` (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/e2e-cleanup-registry-prune-creds/hel-1817`.
- **Design Context is accurate.** `e2e/support/userCleanupRun.cjs:33` runs `psql`, then `:35-40` resolve the root
  (`readBackendEnv`, `resolveUploadsRoot`), then `:47-52` loop `remove(path)` with no catch. `e2e/support/userCleanup.ts:79-80`
  calls it, then `rmSync(dir)`, so any post-commit throw leaves the dir. `startUserRegistry` (`userCleanup.ts:31`) makes a
  fresh `${Date.now()}-${pid}` dir per run and nothing else reads `.e2e-user-registry/` (grep), so the design is right
  that the exact-match failure (`buildUserDeleteSql`'s `IF matched <> n` guard, `userCleanupCore.cjs:106-108`) hits a
  re-run of teardown or the by-hand recovery against the left dir, not a fresh run.
- **Decision 2 is consistent with the code.** `readRegistryDir` (`userCleanupCore.cjs:144-155`) throws ENOENT on a missing dir
  today. The design's "missing dir -> 0" is a deliberate new behaviour, and it is what makes the spec's "next teardown
  accepts the left state" scenario hold. The TS file cannot be imported by the plain-node selftest, so moving the
  logic into the CJS module with injected deps follows the pattern `fakeRun` already uses (`userCleanup.selftest.mjs:245-269`).
- **The caller list is complete.** `grep deleteUsersAndFolders|deleteRecordedUsers` gives exactly `userCleanup.ts`,
  `helio-mcp/scripts/layoutPreconditionSeam.ts:24,237`, `scripts/landing-captures/run.mjs:121-122` and
  `userRegistry.globalTeardown.ts` (which goes through the wrapper). The seam's type cast (`:27`, `{removed; total}`) has to
  gain `failed`. Task 2.2 runs the helio-mcp typecheck, and `helio-mcp/tsconfig.typecheck.json` includes `scripts/**/*.ts`,
  so that gate would catch a miss. The seam's `check()` (`:39-42`) prints `detail` as JSON, so `{failed}` stays count-only.
- **Decision 4 matches db.cjs.** `dbConnection` (`db.cjs:37-46`) maps `DB_USER`/`DB_PASSWORD` to `PGUSER`/`PGPASSWORD`. The prune
  script's `databaseQuery` (`prune-orphan-conversation-folders.mjs:105`) passes `env: process.env` and `secrets: [url, bare]`
  only. The gap the ticket describes is real, and extracting a pure `credentialEnv` keeps `dbConnection` unchanged.
- **Decision 5 is feasible.** `psql()` uses `execFileSync("psql", ...)` with the caller's `env`, so a shim on the
  spawned CLI's `PATH` is reached. When the CLI section runs, the selftest root still has candidate UUID folders
  (`PRESENT`, `IN_SECOND_DB` survive the delete case, `selftest.mjs:125-137`). The query is called only when candidates
  exist (`prune.mjs:42`), so the shim is actually invoked.
- **Decision 6 matches the spec file.** `LocalFileSystemSpec.scala` has 442 lines, three `should` blocks (`:26`, `:277`, `:340`),
  helpers at `:388-441`, and 23 `" in {"` tests. `ClaudeConfigSpec.scala:19,138` cites it for the env helpers, which the design
  names. The CI shard weights (`backend/project/test-suite-weights.tsv:463`) do not block new suite names:
  `TestShards.lpt` gives unknown suites the median weight. `TempDirectorySupport` usage and the reviewed
  `createTempFile` site (`:208-209`) move intact, so `check-test-temp-dir-hygiene` stays satisfied.
- **AC coverage:** AC1 maps to tasks 1.1/2.1/2.4 (red first, plus mutations), AC2 to tasks 1.2/2.3, and AC3 to tasks 1.3/3.2
  (per-suite counts and a sorted-name diff). I found no AC without a task. There is no scope drift beyond the
  ticket: the README update and the ClaudeConfigSpec comment are both direct consequences of the change. The change
  touches no API or schema, so no contract delta is needed.
- **Placeholders/contradictions:** I found no TODO/TBD. Proposal, design, tasks and both spec deltas agree on
  `{removed, failed, total}`, the count-only message, and dir-kept-on-aborted-delete.
- **Baseline selftests are green right now** (TMPDIR in scratch): `userCleanup.selftest.mjs` gives `54 passed, 0 failed`
  (exit 0), and `prune-orphan-conversation-folders.selftest.mjs` gives `14 passed, 0 failed` (exit 0). So any red the
  executor commits will come from the new cases.

### Verdict: CONFIRM

### Non-blocking notes

1. **The user.home redirect has no stated mechanism, and the obvious ones fail silently** (tasks 1.3/3.2, constraint C6).
   With `Test / fork := true`, the forked test JVM gets `runJVMOptions = (Test / javaOptions).value`
   (`backend/build.sbt:227`). The following do NOT redirect it:
   - `HOME=<scratch>`: the JDK on Linux takes `user.home` from the passwd entry.
   - `sbt -Duser.home=...` / `-J-Duser.home=...`: these only affect the launcher JVM.
   - A global `JAVA_TOOL_OPTIONS`: this would also move sbt's own caches, which means a cold dependency fetch.

   The test passes whether or not the redirect worked, so a broken redirect is invisible. Use
   `sbt -batch -Dsbt.server.autostart=false 'set Test / javaOptions += "-Duser.home=<scratch>"; testOnly <Spec>'`.
   Then prove it worked: after the fromEnv run, `<scratch>/.helio/uploads` should exist, and the transcript should
   show that. The practical risk is nil, because the owner's `~/.helio/uploads` already exists (`test -d`, read
   only) and `createDirectories` is a no-op on it. The evidence should still be real.
2. **Root-resolution-failure injection (task 1.1).** `deps.dotEnv` is read eagerly via `??`, so the test needs a dep that
   throws inside the new try block, for example a throwing `dotEnv`/`processEnv` getter or proxy, or a non-string
   `homedir`. Make sure the throw happens inside the post-commit try, not while the deps are being destructured
   before `psql` runs. Otherwise the case will "pass" by never committing.
3. **Prune output and the DB_USER value.** The spec says neither value "appears in the script's output". The selftest's
   unique sentinel satisfies this. In real use, a short `DB_USER` such as an OS username can appear inside printed
   orphan paths (`/home/<user>/...`), and `scrubSecrets` will redact it wherever it appears in error text. This is
   cosmetic and only mirrors `db.cjs`, but don't extend scrubbing to stdout path lines to "fix" it.
4. `layoutPreconditionSeam.ts`'s header comment (`:9-10`) still says it deletes via `buildUserDeleteSql`. Consider
   updating it while touching the file. Optional.
5. `test-suite-weights.tsv` keeps the old single-suite weight (1.045 s). It does not need regenerating here: new
   suites get the median weight.
