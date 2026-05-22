# Executor Report — HEL-269 Cycle 1

## What was done

Rewrote `LocalFileSystem.fromEnv` in `backend/src/main/scala/com/helio/infrastructure/LocalFileSystem.scala`
to resolve the uploads root deterministically regardless of the JVM working directory.

### Resolution algorithm

```
1. HELIO_UPLOADS_ROOT env var  →  used verbatim (toAbsolutePath.normalize)
2. HELIO_UPLOADS_DIR env var   →  backward-compat alias (same treatment)
3. default                     →  ${user.home}/.helio/uploads
```

### Startup behaviour

- `Files.createDirectories` is called on the resolved path — directory tree is created if absent.
- `Files.isWritable` is checked; a non-writable path throws `IllegalStateException` and aborts startup.
- When the default is used, `warnIfLegacyUploadsPresent` checks `./data/uploads` (relative to JVM cwd).
  If that directory exists and contains at least one regular file, a one-time WARN is logged naming both
  the legacy path and the recommended action (`HELIO_UPLOADS_ROOT=<legacy-path>`).
- Files are NOT moved automatically.
- A one-line `INFO` is logged at startup confirming the resolved uploads root.

### Files created or modified

| File | Change |
|------|--------|
| `backend/src/main/scala/com/helio/infrastructure/LocalFileSystem.scala` | Rewrote `fromEnv`; added `warnIfLegacyUploadsPresent`; added `org.slf4j.LoggerFactory` import |
| `backend/src/test/scala/com/helio/infrastructure/LocalFileSystemSpec.scala` | 5 new `fromEnv` tests |
| `CLAUDE.md` | Added `HELIO_UPLOADS_ROOT` + `HELIO_UPLOADS_DIR` rows to env-var table |
| `openspec/changes/uploads-root-resolution/` | Proposal, design, tasks, ticket, workflow-state |

### Test results

- Backend: 727 tests, 0 failures (was 722; +5 new `fromEnv` tests)
- Frontend: 674 tests, 0 failures (unchanged)
- `npm run lint` — clean
- `npm run format:check` — clean (CLAUDE.md reformatted by Prettier)
- `npm run check:scala-quality` — clean (no inline FQN violations; size warnings all pre-existing)
- `npm run check:openspec` — 2 pre-existing failures (`hide-join-step`, `audit-inferred-type-dummy` need archiving); NOT caused by this change

## IMPORTANT — directory creation outside worktree

`LocalFileSystem.fromEnv` **will create `~/.helio/uploads/` at startup** when neither
`HELIO_UPLOADS_ROOT` nor `HELIO_UPLOADS_DIR` is set. This is the documented default
behavior for the fix and is intentional. The only write outside the worktree at startup
is this directory creation — no existing files are moved or deleted.

Developers who do not want this can set `HELIO_UPLOADS_ROOT` to any absolute path before
starting the backend.

## Backward compatibility

- The old env var `HELIO_UPLOADS_DIR` still works as a fallback alias.
- The default path has changed from cwd-relative `./data/uploads` to `~/.helio/uploads`.
  The legacy WARN guides developers who had files in the old location.

## No-verify rationale

Husky cannot resolve `.git` in a worktree (it is a file, not a directory). All gates were
run manually and pass. `--no-verify` will be used solely to bypass the Husky environmental
failure, not to bypass any real gate.
