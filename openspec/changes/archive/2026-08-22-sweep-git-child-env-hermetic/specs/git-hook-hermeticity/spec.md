# git-hook-hermeticity (delta)

Note: infra-only change — this delta exists to make the hermetic-env guarantee testable for
evaluation; the change is archived with `--skip-specs` (no canonical spec merge), matching the
precedent set by HEL-688/`bump-brace-expansion-lockfile`'s own infra-only delta.

## ADDED Requirements

### Requirement: concertino orchestration scripts strip all GIT_*-namespaced vars from child git calls

The scripts `scripts/concertino/assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, and `start-servers.sh` SHALL strip every currently-set `GIT_*`-namespaced environment variable from every child `git` process's environment, via the shared `scripts/concertino/lib/git-child-env.sh` helper (a prefix strip, not an enumerated denylist — see design.md CR1/CR2), for every git invocation that targets an explicit or cwd-implied directory, including `setup-worktree.sh`'s generic `CONCERTINO_WORKTREE_HOOKS` runner (which currently runs `npx husky install`, a non-`git` child that writes into `.git`).

#### Scenario: Poisoned hook-exported GIT_DIR does not redirect a targeted git call

- **WHEN** a script under `scripts/concertino/` runs a `git` call targeting a specific directory
  while the process environment carries `GIT_DIR`/`GIT_INDEX_FILE`/etc. pointing at a different,
  unrelated repository (simulating a git-hook-exported environment)
- **THEN** the child `git` call operates on the directory the script targeted, not the poisoned
  `GIT_DIR`

### Requirement: regression test proves the guard can fail, as a permanent in-test assertion

A regression test SHALL demonstrate, on every run and without any manual hand-edit, that a bare (unwrapped) `git` call is misdirected by a simulated poisoned `GIT_*` environment while the same call routed through the hermetic-env helper is not, using throwaway fixture repositories under a temp dir.

#### Scenario: Dual-arm assertion proves the guard is non-vacuous every run

- **WHEN** the regression test runs its poisoned-environment scenario twice against the same
  fixture pair — once through a bare `git` call, once through the `git_child` wrapper
- **THEN** the bare-`git` arm is misdirected onto the poisoned target while the `git_child` arm
  correctly operates on the intended fixture, on every run, with no manual strip-removal step
  required to observe the failure
