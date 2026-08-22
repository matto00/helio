## Context

`scripts/lib/git-child-env.mjs` established the allowlist pattern (only
PATH/HOME/TMPDIR/LANG/LC_ALL/SystemRoot survive) for Node child-`git` calls,
after a denylist first attempt missed `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`/
`GIT_CONFIG_PARAMETERS`. `scripts/concertino/*.sh` is bash, not Node, and has
no equivalent. All four scripts call `git -C <target-dir> ...` (or, in
`start-servers.sh`, a bare `git rev-parse --show-toplevel` relying on cwd).
Per git's own precedence, `GIT_DIR`/`GIT_INDEX_FILE`/etc. — when present in
the environment — override `-C`-based (and cwd-based) discovery. These
scripts are not today invoked as literal children of `.husky/pre-commit`
(the hook only runs `npm run check:*`/lint/typecheck/format/test), so they
are not exposed to the exact HEL-657 incident path today. The hardening is
defense-in-depth for the concertino orchestration loop generally, matching
the ticket's explicit ask to sweep beyond the hook's direct children.

## Goals / Non-Goals

**Goals:**
- One shared bash helper that strips every currently-set `GIT_*`-namespaced
  variable (a prefix strip, mirroring the Node helper's `nonGitChildEnv` —
  not an enumerated list), usable from all four scripts.
- Every git call in the four scripts routed through it.
- A regression test that proves the guard can go red (poisoned env,
  fixture target diverges from the real repo) and green (fixed).

**Non-Goals:**
- Touching `check-repo-integrity.mjs` (already hermetic, already fast).
- HEL-806/CON-131/CON-132/HEL-799/HEL-734 (explicitly out of scope per the
  ticket).
- Changing `.husky/pre-commit` itself — no concertino script is added to it.

## Decisions

- **Revised after skeptic-design-1 REFUTE (CR1/CR2): `GIT_*`-prefix strip,
  not a six-name denylist.** `scripts/lib/git-child-env.mjs`'s own
  doc-comment records that the exact six-name list this design originally
  proposed shipped once already in this repo and missed
  `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`/`GIT_CONFIG_PARAMETERS` within
  hours ("Denylists fail open"). Its `nonGitChildEnv` already solves this
  on the Node side with a prefix strip, not an enumerated list. Bash has
  the same tool: `${!GIT_@}` expands to every currently-set variable name
  starting with `GIT_`, verified working (including catching an ambient
  `GIT_EDITOR` the six-name list would have missed). `scripts/concertino/
  lib/git-child-env.sh` therefore defines:

  ```sh
  git_child() (
    unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true
    exec git "$@"
  )
  ```

  run in a `()` subshell (not `{ }`) so the `unset` never leaks into the
  caller's own environment. Every script sources this file and replaces
  its bare `git ...` calls with `git_child ...`.
- **`lib/` subdirectory** — matches `scripts/lib/git-child-env.mjs`'s own
  placement; keeps the sourced helper visibly separate from the four
  scripts that consume it.
- **Non-`git` children that shell out to git (CR6, revised after
  skeptic-design-2): wrap the generic hook-runner, not a literal
  `npx husky install` line.** There is no literal `npx husky install` call
  in `setup-worktree.sh` — the real site is the generic hook loop at
  `setup-worktree.sh`'s `CONCERTINO_WORKTREE_HOOKS` section (config'd in
  `scripts/concertino/.concertino.env`, currently
  `CONCERTINO_WORKTREE_HOOKS='npx husky install'`, but arbitrary per
  deployment): `( cd "$WORKTREE_PATH" && eval "$hook" >/dev/null 2>&1 ) ||
  true`. Any configured hook there may write into `.git` (husky's own
  install does), so wrap the loop's `eval` itself with the strip.
  **Revised again after skeptic-final-1 (round 1 of the final gate):** the
  first form proposed here — `( cd "$WORKTREE_PATH" && unset -v $(compgen -v
  GIT_ 2>/dev/null) 2>/dev/null || true; eval "$hook" >/dev/null 2>&1 ) ||
  true` — is a real bug, not just a draft: bash's `&&`/`;` precedence means a
  failed `cd` short-circuits past `unset` but the `; eval "$hook"` clause
  still runs unconditionally, in the caller's still-poisoned cwd — exactly
  the HEL-657 detonation shape. The actual shipped form, verified correct in
  commit 89fbe6a9 and re-verified live (mutation-tested RED against the
  buggy form above, GREEN against this one) at skeptic-final-2, is:
  `( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null)
  2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true` — a failed `cd` exits
  the subshell immediately, before `unset` or `eval` are ever reached; when
  `cd` succeeds, `unset` runs unconditionally (no longer gated behind `&&`)
  and `eval` only runs after both `cd` and the strip have happened. This
  protects every configured hook, not only the one currently configured, and
  needs no per-hook enumeration. `npm ci` itself does not touch `.git` and
  needs no change.
- **Regression test as a standalone bash script**
  (`scripts/concertino/lib/git-child-env.selftest.sh`), not wired into
  `.husky/pre-commit` (these scripts aren't hook children; no reason to add
  hook runtime for them). **Revised after CR4/CR5:**
  - The selftest's own process strips `GIT_*` from itself as its first
    executable statement (`unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null
    || true`) before it ever builds a fixture repo or exports the simulated
    poisoned environment for the scenario under test — the exact HEL-657
    detonation mechanism (a fixture-building test inheriting a real poisoned
    `GIT_DIR`) does not get a second chance to happen inside the selftest
    itself.
  - The npm script name is `selftest:concertino-git-env`, deliberately
    outside the `check:` namespace `.husky/pre-commit` enumerates verbatim
    (`npm run check:*`), with a one-line comment at the wiring site stating
    why: a `check:`-prefixed name is an invitation for a future author to
    append it to the hook, at which point the fixture-building test would run
    as an actual hook child under a real poisoned `GIT_DIR`.
  - Red-before-green is a **permanent in-test assertion**, not a hand-edit:
    the selftest runs its poisoned-env scenario twice against the same
    fixture pair — once through bare `git` and once through `git_child` —
    and asserts the bare-`git` arm *is* misdirected (touches the poisoned
    target, not the fixture) while the `git_child` arm is not. This proves
    the guard is non-vacuous on every run, not just the one time an
    implementer manually removed the strip.

## Risks / Trade-offs

[`${!GIT_@}`/`compgen -v GIT_` behaves differently across bash versions] →
Verified live in this environment; `compgen -v` is bash-builtin since bash
4.0, matching this repo's existing `#!/usr/bin/env bash` scripts (no `sh`
POSIX-compat constraint here). The selftest's dual-arm assertion (Decisions,
above) would itself go red if the expansion silently stopped matching
anything, so a version regression is caught by the test, not just assumed
away.

[Scripts not actually hook children today, so this could read as
speculative hardening] → Ticket explicitly scopes to "every scripts/
concertino/* ... helper", not only literal hook children; keep the change
minimal (helper + wiring + test), no new runtime surface.

## Planner Notes

Self-approved: `${!GIT_@}` prefix-strip over an enumerated denylist, per
skeptic-design-1 CR1/CR2 — verified working by direct execution, and mirrors
`nonGitChildEnv`'s already-proven Node-side approach rather than repeating
the six-name list `gitChildEnv`'s own doc-comment documents as having
already failed once in this repo.
