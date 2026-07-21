# HEL-325 — Concertino: scope cleanup.sh out of evaluator/skeptic tooling

Stray mid-review invocation wipes live worktree git metadata.

## Context

Surfaced during the 2026-07-20 follow-up fleet (HEL-322/321/323/320/324). During
the HEL-323 run, the round-1 final-gate **skeptic invoked**
`scripts/concertino/cleanup.sh` **mid-review**, which removed the *live* worktree's
git admin metadata (`.git/worktrees/<name>`) and deleted the tracked checkout.
`cleanup.sh` is a Phase-4 (post-merge) step — it must never run while a review is in
progress.

## Impact

- The orchestrator had to reconstruct the worktree git-admin dir by hand and restore
  the checkout from the intact commit (recovered, no work/history lost — but fragile
  and time-consuming).
- The manual reconstruction left the worktree inconsistent enough that Phase-4
  `git worktree remove --force` fell back to `prune`, orphaning a 631 MB on-disk
  directory that then required a manual `rm -rf`.
- Second-order: the cycle-2 evaluator separately had to restore the gitignored
  `backend/.env` (not recoverable from git) before it could run live checks.

## Root cause

`cleanup.sh` is reachable from the evaluator/skeptic agents (they have `Bash` and the
script is in-repo). Nothing scopes it to the orchestrator's Phase-4 only.

## Proposed fix

These scripts are **generated** — `scripts/concertino/.concertino.env` header:
`concertino:sync v0.1.3 — do not edit by hand`. So the durable fix lands in the
Concertino source (`~/Development/concertino`) + `concertino sync`, not the script
directly. Options:

1. **Preferred:** ensure evaluator/skeptic agent briefs/tooling never invoke
   `cleanup.sh` — only the orchestrator runs it in Phase 4. Encode the prohibition in
   the rendered agent definitions.
2. Add a guard at the top of `cleanup.sh` that refuses to run unless an explicit
   `--phase4` / post-merge flag (or a sentinel) is present, so a stray call is a
   no-op rather than destructive.
3. Have review agents spot-check that gitignored dev-env files are intact before live
   checks.

## Acceptance

- A review agent (evaluator/skeptic) cannot destroy a live worktree by calling
  `cleanup.sh` (either it's not invoked, or it's a guarded no-op mid-review).
- Fix is made in the Concertino source and re-synced (not a hand-edit of the
  generated script).

## Cross-repo delivery note

The Concertino tooling is generated. Source of truth is the standalone repo at
`~/Development/concertino` (separate git repo, on `main`). Helio's
`scripts/concertino/*.sh` and `.claude/agents/concertino-*.md` are rendered by
`concertino sync` from that repo's `core/` templates + helio's `concertino.config.json`.
Do NOT hand-edit the generated files in helio — fix the source, then sync.
