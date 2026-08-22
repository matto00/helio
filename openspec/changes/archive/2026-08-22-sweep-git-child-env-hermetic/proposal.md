## Why

git overrides `cwd`-based repository discovery with absolute
`GIT_DIR`/`GIT_INDEX_FILE` (and four sibling variables) it exports to hook
subprocesses. HEL-657 fixed this for two Node scripts by routing child
`git` through a hermetic-env helper. `scripts/concertino/*.sh` — four
tracked bash scripts that shell out to `git -C <target-dir>` — still
inherit the caller's full environment, so a future invocation context that
carries a poisoned `GIT_DIR` (e.g. one nested inside a hook subprocess
tree) would silently misdirect these `-C` calls, since git's env variables
win over `-C`.

## What Changes

- Add a bash hermetic-env helper (`scripts/concertino/lib/git-child-env.sh`),
  mirroring `scripts/lib/git-child-env.mjs`'s `nonGitChildEnv` prefix-strip
  approach (not its six-name allowlist, which the same file documents as
  having already failed once), that strips every currently-set
  `GIT_*`-namespaced variable before any child `git` call.
- Route every `git` invocation in `assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh`, `start-servers.sh` through it.
- Add a regression test (`scripts/concertino/git-child-env.selftest.sh` or
  similar) that exports the six poisoned variables (pointing at a
  throwaway fixture repo under a temp dir) and asserts each script's git
  calls still target the directory they were told to, not the poisoned
  `GIT_DIR`. Red-before-green in a throwaway repo, never this one.

## Capabilities

### New Capabilities
(none — internal tooling hardening, no product-facing capability)

### Modified Capabilities
(none — no spec-level behavior change; `scripts/concertino/*.sh` have no
existing OpenSpec capability spec)

## Impact

- `scripts/concertino/assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`,
  `start-servers.sh` (all git-tracked despite the gitignored directory).
- New: `scripts/concertino/lib/git-child-env.sh` (shared helper) and a
  regression test script.
- No production/runtime code paths affected; no schema/API changes.
