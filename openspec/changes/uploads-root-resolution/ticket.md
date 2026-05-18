# HEL-269 — Fix `LocalFileSystem.fromEnv` uploads-root resolution

## Problem

`LocalFileSystem.fromEnv` resolves the uploads root relative to the JVM's current working directory. When the backend is run from a worktree (`/.worktrees/HEL-XXX/backend`), file writes land under the worktree's `backend/data/uploads/` directory. A backend running from the main repo path cannot see those files (and vice versa), causing preview/refresh failures that look like data corruption but are actually path-resolution drift.

## Acceptance criteria

- Uploads root resolution is deterministic regardless of JVM cwd
- A developer running multiple backend instances (worktree + main) can share the same uploads root
- Either backwards-compatible (existing local files still found) or migration documented
