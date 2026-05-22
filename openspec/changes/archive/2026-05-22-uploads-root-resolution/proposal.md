# Proposal — Uploads Root Resolution Fix (HEL-269)

## Problem

`LocalFileSystem.fromEnv` uses `sys.env.getOrElse("HELIO_UPLOADS_DIR", "./data/uploads")` as its default.
When no env var is set, `Paths.get("./data/uploads").toAbsolutePath` resolves against the JVM working directory.
Running the backend from a worktree (`/.worktrees/HEL-XXX/backend`) yields a different absolute path than running it from the main repo, so uploads from one session are invisible to the other.

## Fix

Option A — env-var with home-rooted default:

1. Read `HELIO_UPLOADS_ROOT` (renamed from `HELIO_UPLOADS_DIR`; backward-compatible alias also accepted).
2. Default to `~/.helio/uploads` (`${user.home}/.helio/uploads`) when neither env var is set.
3. Normalise and validate: resolved path must be absolute and writable; fail loud at startup otherwise.
4. Legacy detection: if the default is used AND `./backend/data/uploads/` (the old cwd-relative path) exists and is non-empty, log a one-time WARN recommending the developer set `HELIO_UPLOADS_ROOT` or move files.
5. Create the directory tree at startup if it doesn't exist.

## Non-goals

- Auto-migration of existing files (warn-only)
- Changes to the `FileSystem` trait or any other filesystem implementation
