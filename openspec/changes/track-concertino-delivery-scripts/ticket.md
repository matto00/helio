# HEL-812: Track scripts/concertino/ and make sync deliberate, so worktrees get the delivery scripts

## Description

`.gitignore` ignores `scripts/concertino/` wholesale, but 8 of the 25 present files were force-added at some point. The split is arbitrary and nobody chose it.

A git worktree contains only tracked files, and nothing copies these in — `setup-worktree.sh` has no copy step. So every untracked script is simply absent from every delivery worktree. Agents are instructed to call scripts that are not there. Measured on this ticket's own fresh worktree: 8 files present, 17 absent, including `emit-event.sh`, `persist-evidence.sh`, `tui-attached.sh` (CON-126's escalation gate) and `squash-branch.sh` (CON-129's squash guard).

Two halves, inseparable:

1. Remove `scripts/concertino/` from `.gitignore` and track the delivery scripts. Keep `.concertino/` (per-run artifacts) ignored.
2. Set `CONCERTINO_CLEANUP_SKIP_SYNC=1` for this repo so `cleanup.sh` never auto-renders mid-run. With the files tracked and auto-sync on, every `cleanup.sh --phase4` would leave uncommitted render changes in the working tree, and the next ticket's `git add -A` would sweep them into an unrelated PR.

The setting must live somewhere a re-render will not erase. `scripts/concertino/.concertino.env` is itself a rendered artifact — so it is the right home only because the render now *produces* the value: CON-148 (concertino `bc6342b`) added a `cleanup.skipSync` config boolean, and `renderEnv` emits `CONCERTINO_CLEANUP_SKIP_SYNC=1` when it is `true`. Setting it in the tracked, hand-authored `concertino.config.json` makes the env line a render output rather than a hand edit, so it survives every re-render by construction.

Under this model, changes to these scripts cannot be delivered as helio tickets. They are renders of Concertino's `core/`; a local edit is erased by the next sync. Script changes go to the Concertino repo and arrive here by render. That is a workflow change, and it must be written down where an agent will read it.

Rejected alternative: keep them ignored and have `setup-worktree.sh` copy the directory into each worktree. It adds copy logic to the script that caused the 2026-08-21 repo-bricking incident, and worktree copies would silently drift from the root. Using git as designed is preferable.

## Acceptance criteria

- [ ] AC1 — Every file under `scripts/concertino/` that a delivery run invokes is tracked and present in a freshly created worktree. Verified by creating a worktree and listing the directory, not by inspecting `.gitignore`.
- [ ] AC2 — `.concertino/` remains ignored.
- [ ] AC3 — `cleanup.sh` does not run `concertino sync` automatically in this repo, and the setting survives a re-render (verified by running `concertino sync` twice and confirming the key is still present).
- [ ] AC4 — A `cleanup.sh --phase4` run leaves no uncommitted changes under `scripts/concertino/`.
- [ ] AC5 — The "script changes go upstream to Concertino, not here" rule is documented where an executor will encounter it.
- [ ] AC6 — Stray render artifacts that are not delivery scripts (`pricing-table.json`, `report-cost.sh`) are resolved deliberately. DECIDED: excluded via negative `.gitignore` patterns. They are unreviewed WIP in the upstream Concertino checkout (confirmed `??` in `git -C ~/Development/concertino status`), nothing in helio invokes them, and they leaked in via a render from a dirty working tree. Do not re-litigate.

## Ordering constraint (load-bearing)

`skipSync` must be in effect BEFORE the files become tracked, so that no cleanup run can auto-render into a tracked working tree. The two halves are not separable; landing the `.gitignore` change without `skipSync` is a silent cross-ticket corruption mode.

## Measured baseline (the red)

Fresh worktree off `main@20a0ef20`, before any change — 17 files absent:

```
check-agent-merge-permission.sh  check-gate-chain-change.sh  check-merge-readiness.sh
emit-event.sh  gather-escalation-context.sh  next-report-number.sh  next-ticket-id.sh
persist-evidence.sh  pricing-table.json  report-cost.sh  resolve-speed.sh
set-ticket-state.sh  speeds.json  squash-branch.sh  test-gate-in-isolation.sh
triage-followup.sh  tui-attached.sh
```

15 of those are delivery scripts to be tracked; 2 (`pricing-table.json`, `report-cost.sh`) are the strays to be excluded. Expected after: 23 files present in a fresh worktree.
