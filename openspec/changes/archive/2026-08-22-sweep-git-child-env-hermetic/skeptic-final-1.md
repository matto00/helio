## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff is real and scoped.** `git log --oneline main..HEAD` → single commit `e19e51b7`; `git diff main...HEAD --stat` → 19 files, only the four concertino scripts + new `lib/git-child-env.sh` + selftest + `package.json` + `.husky/pre-commit` comment + change artifacts. No collateral edits.
- **AC 1 — prefix strip, not denylist.** Read `scripts/concertino/lib/git-child-env.sh` in full. `git_child() ( unset -v $(compgen -v GIT_ ...) ...; exec git "$@" )` — genuine `GIT_*` namespace strip, run in a `( )` subshell so the unset cannot leak into the caller. Matches the design decision and the `git-child-env.mjs` rationale.
- **AC 1 — all call sites routed.** Grepped every `git` token in the four scripts (20 occurrences): `grep -nE '(^|[^_[:alnum:]])git[[:space:]]' ... | grep -v git_child` returns only comment/message text (assert-phase.sh:110,144,146; cleanup.sh:146,162; setup-worktree.sh:274-276). No executable bare `git` remains in the four scripts. All four `source "${SCRIPT_DIR}/lib/git-child-env.sh"`.
- **AC 2 — selftest is non-vacuous and passing.** Ran `npm run selftest:concertino-git-env`: 10/10 PASS, exit 0. The dual-arm assertion is genuinely present and permanent: arm 1 asserts bare `git -C $TARGET_REPO` **IS** misdirected onto the poisoned repo (so the simulation provably exercises the bug), arm 2 asserts `git_child` is **not**. Both arms are hard assertions that increment `FAILURES`, not prints.
- **Selftest isolation is bulletproof (the thing this ticket exists to prevent).** Line 35 strips `GIT_*` from the selftest's own process as the first executable statement, before any fixture is built. Every fixture/poison path derives from `WORK="$(mktemp -d)"`; every `git init`/`rm -rf` is `-C`-scoped or path-scoped under `$WORK`. Even with the strip hypothetically broken, the only reachable "wrong" repo is the selftest's own throwaway poison fixture, never this checkout. Empirically confirmed: `git config core.bare` = `false` before AND after the run, and `git status --porcelain` shows no unexpected mutation.
- **Gates re-run by me, not taken on assertion.** `npm run lint` → exit 0; `npm run typecheck` → exit 0; `npm run format:check` → exit 0. `.github/workflows/ci.yml` runs exactly these three.
- **AC 3.** `scripts/check-repo-integrity.mjs` is untouched by the diff (not in `--stat`). Satisfied.
- **AC 4.** No files outside the declared scope touched.

### Verdict: REFUTE

One reproduced, stable correctness defect — introduced by this diff, in exactly the failure class the ticket exists to close.

### Change Requests

1. **`scripts/concertino/setup-worktree.sh:357` — the hook-eval rewrite inverted the `cd` guard, making this line strictly *more* dangerous than the `main` version it replaces.**

   ```bash
   ( cd "$WORKTREE_PATH" && unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true; eval "$hook" >/dev/null 2>&1 ) || true
   ```

   Bash parses this as `{ cd ... && unset ... ; } || true` **followed by a separate `;`-sequenced `eval`**. The `eval` is therefore no longer guarded by the `cd` at all. On `main` the line was `( cd "$WORKTREE_PATH" && eval "$hook" ... )`, where a failed `cd` correctly skipped the hook.

   Reproduced twice, verbatim from the file:

   ```
   --- NEW (branch) line ---
   bash: cd: /definitely-missing-dir: No such file or directory
   CWD=/home/matt/.../HEL-805   GIT_DIR=/poisoned/.git
   --- OLD (main) line ---
   bash: cd: /definitely-missing-dir: No such file or directory
   (no hook execution)
   ```

   So if `cd "$WORKTREE_PATH"` ever fails, the configured hook now executes **in the caller's cwd — the real repo root — with `GIT_*` still fully poisoned**, because the `unset` was short-circuited by the same failed `cd`. That is precisely the HEL-657 detonation shape (a fixture/setup command running against the real repository under an inherited absolute `GIT_DIR`), reintroduced by the mitigation. `CONCERTINO_WORKTREE_HOOKS` defaults to `npx husky install`, which writes into `.git` — the exact class of write that bricked the repo.

   Fix: put the strip and the `eval` both inside the `cd` guard, e.g.

   ```bash
   (
     cd "$WORKTREE_PATH" || exit 0
     unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null || true
     eval "$hook" >/dev/null 2>&1
   ) || true
   ```

   (`unset -v` with zero operands exits 0 — verified — so the `|| true` there is only a defensive backstop and must not sit on the `cd`.)

2. **`scripts/concertino/lib/git-child-env.selftest.sh:171` replicates the same defective line verbatim**, which is why the "eval-site strip" arm passes and is structurally blind to CR 1. After fixing CR 1, this arm must either exercise the real `setup-worktree.sh` line or add a second sub-arm asserting that **a failing `cd` results in the hook not running at all** (assert `${WORK}/hook-output` is absent when `WORKTREE_PATH` points at a nonexistent dir). Without that, the regression test does not cover the one regression this change actually shipped.

### Non-blocking notes

- `selftest:concertino-git-env` is referenced by nothing but `package.json` (grepped `.github/`, `.husky/`, all yml/json). Keeping it out of `.husky/pre-commit` is correct and well-reasoned, but a GitHub Actions step is *not* a hook child and carries none of that risk — adding `- run: npm run selftest:concertino-git-env` to `.github/workflows/ci.yml` (alongside lint/typecheck/format:check) would make "permanent regression assertion" actually true rather than aspirational. Currently nothing will ever notice if it rots.
- The selftest's static wiring check (line ~186) matches a fixed verb list (`-C|rev-parse|worktree|show-ref|fetch|status|merge|update-ref|log`). A future bare `git commit`/`git add`/`git push` in these scripts would pass it silently. A `GIT_ALLOW` -style inverse check (any `git ` not preceded by `_child`) would be tighter.
