# HEL-326 — Concertino: populate frontend/node_modules in worktree setup so Husky hooks run (eliminate commit -n)

Type: task (tooling/infra). Priority: Low. Project: Dev Tooling.

## Context

Every backend-only ticket in the 2026-07-20 fleet (HEL-321/320/324, and partially
323) committed with `git commit -n`, bypassing Husky's pre-commit chain, because the
concertino worktree has no `frontend/node_modules` — so Husky's frontend jest/lint
step can't run. Each bypass was disclosed in the commit body and GitHub CI runs the
full suite, so it's not a correctness risk, but it's recurring friction and defeats
the local gate.

## Root cause

`scripts/concertino/setup-worktree.sh` runs `CONCERTINO_WORKTREE_HOOKS`, which is
currently **only** `npx husky install` (see `.concertino.env`). It installs the hooks
but never populates `node_modules`. The script's own comment (line ~99) even lists
`npm ci` as an example hook — the mechanism already exists; it's just not enabled.

## Options (decision needed)

1. `npm ci` in the worktree hook. Correct and simple, but costs ~30–60s + a few
   hundred MB of `node_modules` per worktree (this was a big chunk of HEL-323's 631 MB
   orphan). Wasteful for backend-only tickets and for parallel fleets.
2. Symlink `frontend/node_modules` → the main checkout's `node_modules` in setup.
   Near-instant, zero extra disk. Risk: a ticket that changes `package.json`/lockfile
   gets stale modules — mitigate with a fallback `npm ci` when the lockfile differs
   from the main checkout's. **Recommended default.**
3. Leave as-is and accept `commit -n` for backend-only tickets (status quo).

## Implementation note

These scripts are generated — the fix lands in the concertino source
(`core/scripts/setup-worktree.sh` template + `bin/concertino` renderEnv/schema and/or
`concertino.config.json`) then `concertino sync`, not a hand-edit of the generated
`setup-worktree.sh`. Delivery is TWO repos: the concertino tool repo and the helio
worktree (regenerated `scripts/concertino/*` + config).

## Acceptance

- A fresh concertino worktree can run the full Husky pre-commit chain (including the
  frontend jest/lint step) without `commit -n`.
- Setup-time and disk cost are acceptable for sequential fleets (measure the chosen
  option).
- Fix is made in the concertino source and re-synced; the regenerated helio
  `scripts/concertino/setup-worktree.sh` contains the change (verified by grep).

## Cross-repo / tooling caveats (from coordinator)

- Concertino source repo: `~/Development/concertino` (separate git repo, authorized).
- Run sync via the LOCAL bin: `node ~/Development/concertino/bin/concertino sync` from
  inside the helio worktree. The global `concertino` (0.1.3) does NOT refresh
  `scripts/*.sh`; 0.1.4 (HEL-325, on local main, unpublished) does.
- After sync, VERIFY the regenerated `scripts/concertino/setup-worktree.sh` contains
  the change (grep). If not, STOP and report — do not hand-forge.
- Root-cause first (systematic-debugging law): actually reproduce a worktree coming up
  without node_modules and Husky failing, and prove the fix makes the frontend hook run.
