## Skeptic Report — final gate (round 2, skeptic-final-2.md)

No UI changes in this diff (`git diff main...HEAD --stat` touches only
`.husky/pre-commit`, `package.json`, `scripts/concertino/*`, and change
artifacts) — the UI/design-judgment section is not applicable and servers
were not started.

### What I verified (with evidence)

**1. The round-1 fix is correct bash (read + hand-traced, not taken on trust).**
`scripts/concertino/setup-worktree.sh:357`:
```
    ( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true
```
Trace: the whole thing is a `( )` subshell, so `exit 0` terminates the
subshell — a failed `cd` returns before `unset` or `eval` are ever reached,
and the outer `|| true` swallows the (zero) status. When `cd` succeeds,
`unset -v ...` is reached unconditionally (it is separated by `;`, not
`&&`), and `unset -v` with an empty expansion returns 0, so the following
`;`-separated `eval` runs only after both the `cd` and the strip. The
script runs under `set -euo pipefail` (line 2); a hypothetical `unset`
failure would abort the subshell *before* `eval`, i.e. fails closed.
Confirmed no other `; eval`/`&&`-precedence residue remains at that site.

**2. The new cd-failure regression case is genuinely non-vacuous —
demonstrated, not read.** All experiments ran on a *copy* of
`scripts/concertino/` under `mktemp -d` (see item 4).
- Unmodified copy: `git-child-env.selftest.sh: ALL PASS` (exit 0), including
  `PASS: setup-worktree.sh CONCERTINO_WORKTREE_HOOKS eval-site pattern
  correctly skipped the hook entirely when cd failed`.
- Mutated the single line 204 back to the OLD pattern
  (`cd "$NONEXISTENT_DIR" && unset ... || true; eval "$hook" ...`) in the
  throwaway copy: the suite went RED —
  `FAIL: ... ran the hook despite a failed cd (target dir did not exist) —
  eval must be unconditionally skipped on cd failure`, exit 1.
  Red-before-green demonstrated on the actual mutation.

**3. Independent re-check of every `git` call site across the four scripts.**
`grep -n '\bgit\b'` on `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`,
`start-servers.sh` shows zero remaining bare `git` invocations (only the
`source lib/git-child-env.sh` lines, a `.git` path test, and two error
*strings*). I read all 24 `git_child` call sites (assert-phase 135/137/
153/154/156/158/160; cleanup 52/69/71/108/109/112/115/124/137/141/151/157;
setup-worktree 211/253/255/256/263/264/266/277; start-servers 45). Every one
is a single command, guarded either by `if ...; then`, a trailing
`|| VAR=""` / `|| return 0`, or a `\`-continued `|| fail`. None is a
`cd X && <guard> ; <unrelated command>` chain, so the round-1 precedence
hazard has no other instance. The only other `cd`-then-`eval` subshells are
`start-servers.sh:84` and `setup-worktree.sh:337`, both pure `&&` chains with
no trailing `;` clause — a failed `cd` short-circuits the entire chain, so
they are not the same hazard. (`start-servers.sh:84` spawns dev/backend
servers, not git children; out of AC-1 scope.)

**4. Nothing in my verification touched this repository.** All mutation
experiments were done on `cp -r` copies under a `mktemp -d` sandbox
(`.../scratchpad/skepXRzY/{concertino,c2}`); the selftest itself builds every
fixture under its own `mktemp -d`. Post-run integrity confirmed:
`git config core.bare` → `false`, `git rev-parse --is-bare-repository` →
`false`, and the worktree's `git status --porcelain` shows only the expected
in-flight `workflow-state.md` / `evaluation-2.md` artifacts.

**5. Full gate suite re-run fresh in the worktree, all green (exit codes read
by me).** `lint=0`, `typecheck=0`, `format:check=0`,
`selftest:concertino-git-env=0` (`ALL PASS`), plus the full pre-commit chain:
`check:repo-integrity=0`, `check:schemas=0`, `check:spec-structure=0`,
`check:openspec=0`, `check:openspec:selftest=0`, `check:scala-quality=0`,
`npm test=0` (`Test Suites: 254 passed`, `Tests: 2751 passed`).

**6. AC trace.** AC1 — met (all four scripts source the helper; helper does a
GIT_* *prefix strip* in a `( )` subshell, stronger than the six-name
denylist the AC asks for; verified by the dual-arm assertion). AC3 — met
(`check-repo-integrity.mjs` untouched by the diff). AC4 — met (diff touches
nothing in the out-of-scope list). AC2 — **partially met**, see CR2 below.

### Verdict: REFUTE

The round-1 bug is genuinely and correctly fixed, and the new regression case
is genuinely non-vacuous — I proved both. But two cheap, low-risk gaps remain,
and both are precisely the failure shape this ticket exists to eliminate
("a guard that looks present but doesn't actually apply").

### Change Requests

1. **`openspec/changes/sweep-git-child-env-hermetic/design.md:70-72` still
   prescribes the buggy pattern as the fix.** It reads, verbatim:
   `( cd "$WORKTREE_PATH" && unset -v $(compgen -v GIT_ 2>/dev/null)
   2>/dev/null || true; eval "$hook" >/dev/null 2>&1 ) || true` — the exact
   `&&`/`;` sequencing bug skeptic-final-1 refuted and commit 89fbe6a9 fixed.
   This design doc is the artifact that gets archived as the durable record
   of *how* to do this, so shipping it hands the next reader the detonation
   pattern. Update it to the shipped `cd ... || exit 0; unset ...; eval ...`
   form, and add one sentence recording why (a failed `cd` must
   unconditionally skip the `eval`; `&& ... || true; eval` does not).

2. **The selftest's eval-site cases test a *copy* of the pattern, not
   `setup-worktree.sh`, and nothing enforces that the two stay in sync — so
   a regression in the real script is not caught.** The selftest comment at
   `scripts/concertino/lib/git-child-env.selftest.sh:168` asserts "This
   mirrors setup-worktree.sh's actual line verbatim", but that mirroring is
   unenforced. Demonstrated in the sandbox: I reverted **only**
   `setup-worktree.sh:357` to the old buggy pattern and left the selftest
   pristine — the suite still reported `git-child-env.selftest.sh: ALL PASS`.
   That means the AC-2 assertion does not actually cover the shipped script's
   eval site. Fix cheaply inside the existing `--- static wiring check ---`
   loop: add a `grep -qF` assertion that `setup-worktree.sh` contains the
   exact `cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_` prefix
   (and correspondingly does *not* contain the `cd "$WORKTREE_PATH" &&
   unset` form), failing with a message pointing at this drift. That closes
   the copy-vs-source gap without re-plumbing the test to invoke
   `setup-worktree.sh` for real.

### Non-blocking notes

- `scripts/concertino/` in this worktree is missing the orchestration helper
  scripts present in the main checkout (`next-report-number.sh`,
  `persist-evidence.sh`, `emit-event.sh`, ...) because the directory is
  gitignored and only the six tracked files come across. I ran them from the
  main checkout. This is the already-filed HEL-799/HEL-734 gap, explicitly
  out of scope here — noting only so it isn't mistaken for a regression from
  this change.
- `unset -v` inside the eval-site guard runs under `set -euo pipefail`; if a
  `GIT_*` variable were ever readonly, the subshell aborts before `eval`.
  That is the right (fail-closed) direction, but it is undocumented at the
  call site — one clause in the existing comment would make it deliberate
  rather than incidental.
