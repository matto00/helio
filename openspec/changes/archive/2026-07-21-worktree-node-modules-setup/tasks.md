## 1. Reproduce (systematic-debugging law — do this first)

- [x] 1.1 In a throwaway worktree created by the CURRENT `setup-worktree.sh`, confirm `frontend/node_modules` is absent and a `git commit` touching a frontend file fails Husky's frontend step (must `commit -n`). Capture the evidence.

## 2. Concertino source — template + generator + schema (~/Development/concertino)

- [x] 2.1 Branch the concertino repo (e.g. `task/worktree-link-node-modules/HEL-326`) off `main`.
- [x] 2.2 In `core/scripts/setup-worktree.sh`, add a dedicated module-populate step driven by `CONCERTINO_LINK_MODULES` (space-separated module dirs), placed AFTER env-file copy and BEFORE the `CONCERTINO_WORKTREE_HOOKS` loop (so `npx husky install` sees populated modules). Per dir M (parent P=dirname M, lockfile P/package-lock.json): skip if worktree M already exists (real dir or link); if main M exists AND worktree lockfile matches main lockfile (`cmp -s`) → HARDLINK COPY `cp -al "$REPO_ROOT/M" "$WORKTREE_PATH/M"` (NOT a symlink — a symlink into the main checkout is destructive: `npm ci` in the worktree wipes the shared main node_modules, verified in design-gate round 1); on `cp -al` failure (e.g. EXDEV) fall back to `npm ci` in `$WORKTREE_PATH/P`; if lockfiles differ or main M missing → `npm ci` in `$WORKTREE_PATH/P`; if neither lockfile nor main M exists → `note:` and continue.
- [x] 2.2a CRITICAL: the script runs under `set -euo pipefail`. Guard EVERY fallible command in this step (`cmp -s`, `cp -al`, `npm ci`) with explicit `if`/`||` so a failure degrades to `echo "note: <what> for $M" >&2` and continues — setup MUST still reach the `READY` lines (mirror the existing hooks loop's `|| true`).
- [x] 2.3 In `bin/concertino`, `renderEnv`: emit `CONCERTINO_LINK_MODULES` from `c.worktree.linkModules` (join with space, same pattern as `CONCERTINO_ENV_FILES`). Add a `withDefaults` default (`worktree.linkModules = worktree.linkModules || []`).
- [x] 2.4 In `config/concertino.schema.json`, document `worktree.linkModules` (array of strings; module dirs relative to repo root; lockfile assumed at `dirname(dir)/package-lock.json`).
- [x] 2.5 Update the template header comment block to list `CONCERTINO_LINK_MODULES` alongside the other env vars.

## 3. Helio config + re-sync

- [x] 3.1 In helio `concertino.config.json`, add `worktree.linkModules: ["frontend/node_modules"]`.
- [x] 3.2 Re-sync from the helio worktree: `node ~/Development/concertino/bin/concertino sync`.
- [x] 3.3 VERIFY the regenerated `scripts/concertino/setup-worktree.sh` contains the new step (grep for `CONCERTINO_LINK_MODULES`) and `.concertino.env` contains the rendered field. If absent, STOP and report — do not hand-forge.

## 4. Tests — prove the fix

- [x] 4.1 Create a fresh test worktree with the re-synced helio `setup-worktree.sh`; confirm `frontend/node_modules` resolves (hardlink copy of main) and Husky's frontend step runs WITHOUT `commit -n`. Capture evidence. Measure setup time + disk delta (`du` apparent vs. actual to show shared inodes).
- [x] 4.2 SAFETY: after the hardlink copy, run `npm ci` inside the test worktree's `frontend/` and confirm the MAIN checkout's `frontend/node_modules` is left intact (the failure mode the symlink approach had). Verify idempotency (re-run setup — no error, no duplicate) and the lockfile-drift fallback (simulate a differing `frontend/package-lock.json` → `npm ci` branch taken).
- [x] 4.3 FAILURE-INJECTION: force the populate step's fallible command to fail (e.g. point at a corrupt lockfile / unreachable registry) and confirm `setup-worktree.sh` still emits a `note:` and reaches its `READY` lines (never-abort requirement). Remove all throwaway test worktree(s) after (do NOT touch this ticket's worktree).
- [x] 4.4 Run `shellcheck` on the edited `core/scripts/setup-worktree.sh` if available; ensure no new warnings.

## 5. Commit + handoff (both repos)

- [x] 5.1 In the concertino repo: commit the source changes on its branch; push; open a PR to concertino `main`. Do NOT merge. (Commit done on `task/worktree-link-node-modules/HEL-326`; push + PR deferred to delivery per orchestrator.)
- [x] 5.2 In the helio worktree: run the gates (lint/format:check/test are root scripts; `npm run build` is a frontend/ script; check:schemas at root). The fix should let this commit run WITHOUT `commit -n` — verify that.
- [ ] 5.3 In the helio worktree: commit the regenerated `scripts/concertino/*` + `concertino.config.json`; write `files-modified.md`. Report BOTH branch names and (after PRs) both PR URLs. (Push + PR deferred to delivery; leaving unchecked so `check:openspec` does not flag the change as complete-but-unarchived before the delivery-phase archive.)
