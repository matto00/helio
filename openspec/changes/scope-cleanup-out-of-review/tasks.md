## 1. Concertino source — guard + roles + sync (repo: ~/Development/concertino, new branch)

- [x] 1.1 Branch from `main`: `task/scope-cleanup-out-of-review/hel-325`
- [x] 1.2 `core/scripts/cleanup.sh`: add a Phase-4 guard — proceed only if first arg is
      `--phase4` OR `CONCERTINO_PHASE4=1`; else print refusal to stderr and `exit 0`;
      `shift` the flag so positional args still work; update the usage/header comment
- [x] 1.3 `core/roles/orchestrator.md`: Phase-4 invocation passes `--phase4`; add a
      guardrail note that only the orchestrator runs cleanup and only post-merge
- [x] 1.4 `core/roles/evaluator.md`: add guardrail prohibiting any `cleanup.sh` invocation
      (Phase-4 orchestrator-only; destroys the live worktree mid-review)
- [x] 1.5 `core/roles/skeptic.md`: add the same `cleanup.sh` prohibition guardrail
- [x] 1.6 `bin/concertino`: `cmdSync` → `copyAssets(out, dry, true)` so sync refreshes
      canonical `scripts/concertino/*.sh`
- [x] 1.7 `package.json`: bump version `0.1.3` → `0.1.4`
- [x] 1.8 Commit on the concertino branch; push. (PR opened by the orchestrator in delivery — not opened here.)

## 2. Helio — regenerate via sync and commit (repo: helio worktree)

- [x] 2.1 From the helio worktree run the DEV bin (global CLI is a stale independent copy):
      `node /home/matt/Development/concertino/bin/concertino sync --out=<WORKTREE_PATH>`
      (Note: `--out=<path>` `=`-form required; `parseArgs` does not consume a space-separated value.)
- [x] 2.2 Confirm regenerated `scripts/concertino/cleanup.sh` contains the guard;
      `.concertino.env` header shows `v0.1.4`; evaluator/skeptic agent defs contain the
      prohibition; orchestrator def passes `--phase4`
- [x] 2.3 Commit the regenerated `scripts/concertino/*` + `.claude/agents/concertino-*`
      files on the helio branch

## 3. Tests / verification

- [x] 3.1 `bash -n` syntax-check both cleanup.sh copies (source + regenerated)
- [x] 3.2 Simulate a stray mid-review call: run regenerated `cleanup.sh <path> <ports>`
      WITHOUT `--phase4` against a throwaway worktree; confirm it is a no-op (worktree
      still present, exit 0, refusal on stderr)
- [x] 3.3 Confirm a `--phase4` call still tears down correctly (throwaway worktree)
- [x] 3.4 If the dev bin cannot render (sync fails), STOP and report — do not hand-forge
      generated files (sync rendered successfully via the `--out=` form)
