### Implementation

- [x] 1.1 Create `scripts/concertino/lib/git-child-env.sh`: sourced helper
      exposing `git_child()`, a `()` subshell that runs
      `unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true` then
      `exec git "$@"` — a `GIT_*`-prefix strip (verified working, catches
      every `GIT_*`-namespaced variable, not an enumerated list; see
      skeptic-design-1 CR1/CR2). Doc-comment cross-references
      `scripts/lib/git-child-env.mjs`'s `nonGitChildEnv` (the Node-side
      prefix-strip this mirrors) and HEL-805/HEL-657.
- [x] 1.2 Route every `git` invocation in `scripts/concertino/assert-phase.sh`
      through `git_child`.
- [x] 1.3 Route every `git` invocation in `scripts/concertino/cleanup.sh`
      through `git_child`, including the bare cwd-based
      `git rev-parse --show-toplevel`.
- [x] 1.4 Route every `git` invocation in `scripts/concertino/setup-worktree.sh`
      through `git_child`, including the bare cwd-based calls (`rev-parse`,
      `worktree list/add`, `show-ref`, `fetch`). Also strip `GIT_*` in the
      generic `CONCERTINO_WORKTREE_HOOKS` loop's `eval "$hook"` (CR6 — there
      is no literal `npx husky install` call; the real site is this
      config-driven loop, currently configured with `npx husky install`,
      which writes into `.git/hooks` and is exposed to the same
      poisoned-`GIT_DIR` misdirection as a direct git call. Stripping the
      loop itself protects any hook configured there, not only the current
      one).
- [x] 1.5 Route the `git rev-parse --show-toplevel` in
      `scripts/concertino/start-servers.sh` through `git_child`.

### Tests

- [x] 2.1 Add `scripts/concertino/lib/git-child-env.selftest.sh`. First
      executable statement strips `GIT_*` from the selftest's own process
      environment (before building any fixture or exporting the simulated
      poisoned environment — CR4). Builds two throwaway repos under
      `mktemp -d`: a "target" fixture and an unrelated "poisoned" repo.
      Exports the six repo-locating `GIT_*` variables (`GIT_DIR`,
      `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`,
      `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`) pointing at
      the poisoned repo, simulating a hook-exported environment, then runs
      the scenario twice against the target fixture: once through bare
      `git`, once through `git_child` (CR5). Asserts the bare-`git` arm IS
      misdirected (poisoned repo mutated, target fixture untouched) and the
      `git_child` arm is NOT (target fixture mutated as intended, poisoned
      repo untouched). This makes red-before-green a permanent, every-run
      in-test assertion rather than a one-off manual observation.
- [x] 2.2 Also exercise each of the four scripts' actual `git_child`-wrapped
      call sites (not just the helper in isolation) against the poisoned-env
      simulation, confirming each still targets its intended directory.
- [x] 2.3 Wire `npm run selftest:concertino-git-env` (deliberately outside the
      `check:` namespace `.husky/pre-commit` enumerates — a `check:`-prefixed
      name invites a future author to add it to the hook, at which point this
      selftest's own fixture-building would run as a real hook child under a
      real poisoned `GIT_DIR`; comment states this at the wiring site) to run
      the selftest. Not added to `.husky/pre-commit`.
