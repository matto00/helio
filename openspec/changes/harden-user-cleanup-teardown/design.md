## Context

See proposal.md (Why). Today `deleteUsersAndFolders` (`e2e/support/userCleanupRun.cjs`) runs psql (the delete commits),
then resolves the uploads root (reads `backend/.env` via `db.cjs`) and loops `remove(path)` with no catch.
`deleteRecordedUsers` (`e2e/support/userCleanup.ts`) calls it and only then `rmSync`s the registry dir, so any throw
after the commit leaves the dir behind. A fresh Playwright run gets a new `<runId>` dir, so the thing that "fails the
exact-match check" is a re-run of teardown / the documented by-hand recovery against the left dir: its users are
already gone, and `buildUserDeleteSql` raises.

## Goals / Non-Goals

**Goals:** a post-commit failure never leaves a registry naming deleted users; failures stay loud but count-only; the
prune script connects with env-var credentials; a behaviour-preserving spec split with equal per-suite counts.

**Non-Goals:** retrying folder removal; recording failed ids anywhere (the prune script is the recovery path for any
folder left behind: it finds folders whose user is in no database); making the prune script read `backend/.env`;
changing which folders are removed; any product code change.

## Decisions

1. **Post-commit phase is total.** In `deleteUsersAndFolders`, everything after `psql` returns runs inside try/catch:
   a root-resolution failure (reading `backend/.env`, `resolveUploadsRoot`) counts every path as failed; each folder's
   symlink check + `remove` is caught individually and counted. Returns `{removed, failed, total}`. Log line, numbers
   only: `<label>: removed R of N conversation folders, F failed`. psql failure still throws, before any folder work
   (unchanged). Alternative considered: throw after the loop - rejected, it forces every caller to distinguish a
   committed-then-failed throw from an aborted-delete throw by message parsing.
2. **Registry teardown moves into CommonJS.** New `deleteRegistryRun(dir, deps)` in `userCleanupRun.cjs`: reads the dir
   (`readRegistryDir`), calls `deleteUsersAndFolders` when there are records (a psql throw propagates, dir kept),
   then `rmSync(dir)`, then if `failed > 0` throws `userCleanup: F of N conversation folders could not be removed (the
   users were deleted; run scripts/prune-orphan-conversation-folders.mjs to find leftovers)` - no id, no path. Missing
   dir or unset env -> returns 0. `deleteRecordedUsers` in `userCleanup.ts` becomes a thin wrapper passing
   `process.env[REGISTRY_ENV]`. Reason: the selftest is plain `node` .mjs and cannot import the TS file; this makes the
   exact production path testable with injected fakes (same pattern `deleteUsersAndFolders` already uses).
   Alternative: write a "failed" marker into the registry dir - rejected, it still leaves a dir naming deleted users.
3. **Other callers.** `layoutPreconditionSeam.ts`: add `check("conversation folders removed with no failure",
   result.failed === 0, {failed})` (count only). `landing-captures/run.mjs`: set `process.exitCode = 1` and log the
   failed count when `failed > 0`. Their user-delete verification is unchanged.
4. **Prune credentials via a shared helper.** Extract from `db.cjs` `dbConnection` a pure exported
   `credentialEnv(baseEnv, user, password)` returning `{...baseEnv, PGUSER?, PGPASSWORD?}`; `dbConnection` uses it
   (behaviour unchanged). The prune script's `databaseQuery` reads `process.env.DB_USER`/`DB_PASSWORD` only (not
   `backend/.env`: the script takes explicit URLs and no defaults, and may target several databases), passes
   `env: credentialEnv(process.env, user, password)` and adds both to `secrets` for the psql call and for its own
   catch's `scrubSecrets`. A URL's embedded user/password still wins inside libpq (unchanged precedence).
5. **Selftest for item 2 uses a fake `psql` on PATH.** A temp-dir `psql` shell shim (written with a quoted heredoc or
   `writeFileSync`, chmod 755) records only booleans `PGUSER==sentinel`, `PGPASSWORD==sentinel` into a temp file and
   either prints nothing (success) or writes the sentinels to stderr and exits 2 (failure mode, to prove the scrub).
   The CLI is spawned with `PATH=<shim>:$PATH`, `DB_USER`/`DB_PASSWORD` sentinels, a credential-less URL, a temp
   uploads root. Assertions: shim saw both values; stdout+stderr never contain either sentinel or the URL; failure
   mode exits non-zero with `<redacted>`.
6. **Split** `LocalFileSystemSpec.scala` by its three existing `should` blocks: `LocalFileSystemSpec` (core
   read/write/list/atomic publish), `LocalFileSystemPruneSpec` (HEL-1802 directory pruning),
   `LocalFileSystemFromEnvSpec` (fromEnv + env-mutation helpers + `baseDir` accessor). Test names, bodies and order
   unchanged; each file keeps only the imports/helpers it uses. Update the `ClaudeConfigSpec` comment that cites
   `LocalFileSystemSpec` for the env helpers to cite `LocalFileSystemFromEnvSpec`. Counts measured with `sbt testOnly`
   per suite before (one suite) and after (three), committed as evidence; the fromEnv run uses `user.home` redirected
   to a scratch dir so the "default to ~/.helio/uploads" test cannot create anything under the real home.

## Risks / Trade-offs

- [A failed folder's id is no longer recoverable from the registry] -> by design; the folder is findable by the prune
  script (its user is in no database), and the teardown error says so.
- [The env-mutation helpers rely on reflection into `System.getenv()`] -> moved verbatim, same JVM fork settings.
- [Teardown now throws after clearing the registry, failing the Playwright run] -> same loudness as today; only the
  registry state differs.
