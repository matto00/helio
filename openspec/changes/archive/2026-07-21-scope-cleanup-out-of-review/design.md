## Context

Concertino is a standalone tool (`~/Development/concertino`, separate git repo) that
renders orchestration assets into consuming repos via `concertino sync`. Helio's
`scripts/concertino/*.sh` and `.claude/agents/concertino-*.md` are generated; the
`.concertino.env` header reads `concertino:sync v0.1.3 — do not edit by hand`.

`core/scripts/cleanup.sh` runs `git worktree remove --force` + `git worktree prune`
with no guard. It is copied verbatim into every consuming repo (`bin/concertino`
`copyAssets`, verbatim `copy`). Evaluator and skeptic agents both have `Bash` and run
inside the worktree, so the in-repo script is reachable and executable by them. During
HEL-323 the final-gate skeptic ran it mid-review and wiped the live worktree.

Two confirmed facts from reading the source:
1. `bin/concertino` `cmdSync` calls `copyAssets(out, dry, false)` — `withScripts=false`,
   so **sync does not refresh `scripts/concertino/*.sh`**; only `init` does. The `.sh`
   files carry no `concertino:sync v` marker, so `upgrade`/`doctor` don't track them
   either. A script-only fix therefore cannot reach a consuming repo through sync today.
2. The global CLI at `/usr/lib/node_modules/concertino` is an **independent copy**, not
   a symlink to the dev repo. Rendering the edited templates requires invoking the dev
   repo's bin directly (`node ~/Development/concertino/bin/concertino sync --out <repo>`).

## Goals / Non-Goals

**Goals:**
- A review agent (evaluator/skeptic) cannot destroy a live worktree via `cleanup.sh`.
- The fix is delivered in the Concertino source and reaches helio via `sync` — not a
  hand-edit of the generated script.

**Non-Goals:**
- No change to worktree setup, port derivation, or server startup behavior.
- No change to the destructive behavior when correctly invoked in Phase 4.
- Not addressing the separate `backend/.env` / `node_modules` gaps (companion tickets).

## Decisions

**D1 — Guard `cleanup.sh` on an explicit Phase-4 opt-in (belt).** Add a guard at the
top of `core/scripts/cleanup.sh`: proceed only if the first argument is `--phase4` or
`CONCERTINO_PHASE4=1` is set; otherwise print a refusal to stderr and `exit 0` (safe
no-op). Accepting `--phase4` as the first arg (then `shift`) keeps the existing
positional `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>` contract intact.
- *Why exit 0, not non-zero:* the ticket asks for a "safe no-op." A legitimate Phase-4
  call that forgot the flag still self-corrects — the orchestrator's subsequent
  `assert-phase.sh cleanup` fails (worktree still present) and surfaces it.
- *Alternative rejected:* removing `Bash` from review agents — too blunt; they need
  Bash for gates and server startup.

**D2 — Prohibit `cleanup.sh` in the evaluator/skeptic role templates (suspenders).**
Add a guardrail line to `core/roles/evaluator.md` and `core/roles/skeptic.md`: never
invoke `cleanup.sh`; it is Phase-4 orchestrator-only and destroys the live worktree
mid-review. This is the ticket's "preferred" option and re-renders on every sync.

**D3 — Update the orchestrator's Phase-4 invocation.** `core/roles/orchestrator.md`
Phase-4 calls `cleanup.sh --phase4 "$WORKTREE_PATH" ...`, plus a guardrail note that
only the orchestrator runs it and only post-merge.

**D4 — Make `sync` refresh canonical scripts (enabling fix).** Change `cmdSync`'s
`copyAssets(out, dry, false)` to `copyAssets(out, dry, true)`. Without this the guard
cannot reach consuming repos via sync — the mechanism the ticket mandates. `copyAssets`
already chmods `.sh` to 0755 and is idempotent, so this is safe.

**D5 — Version bump `0.1.3 → 0.1.4`.** So the regenerated `.concertino.env` header
reflects the change and `upgrade` flags consuming repos as stale (via the single
`.concertino.env` sync marker; note `doctor` only checks runtime tooling, not
generated-file staleness).

## Risks / Trade-offs

- [Guard breaks a legitimate Phase-4 call if the orchestrator template isn't updated in
  lockstep] → D3 updates the orchestrator invocation in the same change; verified by
  grepping the rendered file post-sync.
- [`sync` now overwrites local script tweaks in consuming repos] → Intended: the header
  says "do not edit by hand"; scripts are canonical. No known local overrides exist.
- [Global CLI is stale/independent] → Deliver by running the dev repo's bin explicitly;
  documented in tasks. If the dev bin cannot render, STOP — never hand-forge generated files.

## Planner Notes

- Self-approved: modeling the durable contract as a new `concertino-worktree-safety`
  capability spec (concertino tooling is not otherwise specced in helio's openspec).
- Self-approved: including D4 (sync-copies-scripts) as in-scope — it is the enabler that
  makes "fix in source + re-sync" actually work for a script change.
- Delivery spans two repos and two PRs (concertino source + helio regenerated files);
  this is inherent to a generated-tooling fix, not scope creep.
