## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Scope reviewed: the Phase-4 fold-in ADDED scope only — ticket.md "Fold-in
scope", proposal.md's fold-in bullet, design.md D11, tasks.md group 5
(5.1–5.3). The pre-existing skeptic-design-1.md / evaluation-1.md /
skeptic-final-1.md in this dir are the first delivery's (merged, PR #672) and
were not re-reviewed.

### What I verified (with evidence)

- **Cwd guard**: `pwd -P` → `/home/matt/Development/helio`;
  `scripts/concertino/assert-cwd.sh` against `WORKTREE_PATH`/`BRANCH` →
  `READY ambient=... branch=task/mistakes-md-commit-traps/HEL-1085`. Proceeded.
- **Change-dir restore**: `git status` shows the archive→active `git mv` staged
  (9 files renamed, uncommitted) plus unstaged edits to `design.md`,
  `proposal.md`, `tasks.md`, `ticket.md` — matches the reported Phase-4
  fold-in mechanics.
- **`## Tooling` section anchor**: `grep -n "^## Tooling" MISTAKES.md` → line
  224; `Linear: closing an epic cascades` (the epic-cascade entry) → line 252.
  D11 cites `MISTAKES.md:224-262` and "after the epic-cascade entry" —
  matches ground truth exactly.
- **Husky chain**: read `.husky/pre-commit` directly — it runs
  `check:repo-integrity`, lint, `typecheck`, `check:e2e-types`,
  `check:helio-mcp-types`, `format:check`, `check:schemas`,
  `check:spec-structure`, `check:openspec` (+selftest), `check:dependabot`
  (+selftest), `check:scala-quality`, `check:test-temp-dir-hygiene`
  (+selftest), `check:no-credential-leak` (+selftest), `check:tokens`
  (+selftest), and `npm test` — a long chain, consistent with D11's "far past
  a 120s default" framing and tasks.md's "600000 ms" figure. D11's
  "four typechecks (frontend, e2e, helio-mcp)" is loose (I count `typecheck`
  + `check:e2e-types` + `check:helio-mcp-types` = 3 typecheck-named scripts,
  plus lint separately) but this is a parenthetical gloss, not a claim the
  entry text itself needs verbatim — non-blocking.
- **Prettier scope**: `.prettierignore` excludes `openspec` (among others) but
  **not** root `*.md` — `MISTAKES.md` is at repo root, so D11's claim "root
  markdown is NOT in `.prettierignore`, unlike `openspec/`" is correct, and
  `npm run format:check` in tasks 5.1/5.2's verify steps is the right gate.
- **`await-sentinel.sh` mechanism**: read the script's header comment. It is a
  single foreground, bounded poll on a sentinel *file's existence*, with no
  `pgrep`/`pkill` — exactly the shape D11(a) cites for recovery. Checked
  `git-hooks(5)` ordering knowledge against this repo's actual worktree
  layout: `git rev-parse --git-dir` → `.git` (gitfile pointer);
  `git rev-parse --git-common-dir` → `/home/matt/Development/helio/.git`;
  the real per-worktree dir is `.git/worktrees/HEL-1085/`, and
  `COMMIT_EDITMSG` does not currently exist there (`ls` empty, `cat` exit 1)
  — consistent with it being written only once `prepare-commit-msg` runs,
  which per githooks(5) ordering fires *after* `pre-commit` completes. So
  waiting on that file's appearance is a mechanically sound "hook chain
  finished" signal, not a mischaracterization.
- **`--skip-specs` correctness**: `npx openspec archive --help` confirms
  `--skip-specs` — "Skip spec update operations (useful for infrastructure,
  tooling, or doc-only changes)". This scope touches only `MISTAKES.md`
  (docs) — no source/spec/schema change per the ticket's added AC — and the
  change's only spec delta (`specs/form-panel-rendering/spec.md`) was already
  applied by the first archive (2026-09-17). Re-running spec-update on
  re-archive would be a no-op at best; `--skip-specs` is the correct mode.
- **Hygiene-script treatment of the restored dir**: read
  `scripts/check-openspec-hygiene.mjs`'s header — a fully-checked change is
  reported only when "escaped" or "stale"; a change with unchecked tasks
  (tasks 5.1–5.3 are `[ ]`) is not fully-checked at all, so it is
  unconditionally in-flight/exempt regardless of the escaped/stale logic.
  The restored dir with open tasks will not spuriously trip this gate.
- **Scope containment**: task 5.3 gates the commit on
  `scripts/concertino/resolve-review-base.sh`-diffed paths being only
  `MISTAKES.md` and `openspec/changes/form-field-renderers/**` — matches the
  ticket's "no source, spec, or schema change" AC and is a real,
  machine-checked guard (not just a promise), satisfying C2/C9-style
  self-discipline for this docs-only scope.
- **Internal consistency**: ticket.md "Fold-in scope", proposal.md's fold-in
  bullet, design.md D11, and tasks.md 5.1–5.3 all describe the same two
  entries, same recovery mechanisms, same rejected alternative (standalone
  ticket), and the same re-archive mode — no contradiction found across the
  four revised artifacts.
- **Standing Constraints**: tasks.md's Standing Constraints list still
  includes C1–C6 verbatim from the first delivery, with C2 (explicit 600000 ms
  timeout, no bespoke poll shells, anchored `pgrep` or `await-sentinel.sh`)
  the one this scope operationalizes into the two new MISTAKES.md entries —
  consistent with the brief.

### Adversarial checks that did NOT find a defect

- Placeholder/hand-waving: none found — D11 and tasks 5.1–5.3 specify exact
  section placement, exact recovery commands, and machine-checkable verify
  steps (`grep -c`, `format:check`, diff-scope check), not deferred decisions.
- Ambiguity: "immediately after the epic-cascade entry" in both D11 and task
  5.1/5.2 is unambiguous given the grep-verified anchor.
- Scope drift: none — every added AC in ticket.md maps 1:1 to a task (5.1→AC1,
  5.2→AC2, 5.3→AC3/no-other-path), and no task reaches outside `MISTAKES.md`
  + the change dir.
  Missing acceptance signal: each task carries a concrete verify command.

### Verdict: CONFIRM

The fold-in design (D11) and its tasks (5.1–5.3) are sound, correctly
mechanistic (the `COMMIT_EDITMSG`-as-completion-signal claim holds up against
git's actual hook ordering and this worktree's actual `.git/worktrees/`
layout), correctly scoped (docs-only, `--skip-specs` re-archive is the right
call given the spec delta already merged), and internally consistent across
all four revised artifacts. No revision required before Execution.

### Non-blocking notes

- D11's parenthetical "four typechecks (frontend, e2e, helio-mcp)" undercounts
  slightly against the literal `.husky/pre-commit` script (3 typecheck-named
  scripts + `lint` separately) — cosmetic only, doesn't affect the trap
  entry's content or the task verify steps.
