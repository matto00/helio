# HEL-1123: Four pre-commit checks never run in CI — a hook bypass ships schema drift and Scala-quality violations past ci-complete

## Description

Four checks run **only** in the Husky pre-commit hook (`.husky/pre-commit`). No workflow in `.github/workflows/` runs them, either by npm script name or by underlying script path (verified 2026-09-11):

| npm script | Underlying script |
| -- | -- |
| `check:repo-integrity` | `scripts/check-repo-integrity.mjs` |
| `check:scala-quality` | `scripts/check-scala-quality.mjs` |
| `check:schemas` | `scripts/check-schema-drift.mjs` (schema drift) |
| `check:spec-structure` | `scripts/check-spec-structure.mjs` |

So any commit made with `--no-verify` or `-n`, `HUSKY=0`, or from a worktree whose hooks cannot run ships these checks unenforced, and the required `ci-complete` still goes green. `CLAUDE.md` explicitly allows a disclosed `git commit -n` bypass on the assumption that CI is the backstop. For these four gates, there is no backstop.

**Found while** investigating a harness "[CI Bypass]" flag on HEL-1080's delivery (2026-09-11).

## Acceptance Criteria

* CI runs all four checks, ideally in a job that `ci-complete` depends on.
* Add a guard that fails if `.husky/pre-commit` gains a check that no workflow runs. For example, a script that diffs the hook's `npm run` list against the workflows, so the two cannot drift again.
* Run all four on current `main` as part of the change; fix, or file, anything they flag.

## Driver context (not part of the ticket, carried from the delivery brief)

- Follow the existing `ci-complete` `needs: [...]` aggregation pattern (see HEL-913/846/1037/996 precedent comments in `.github/workflows/ci.yml`) rather than inventing a new one.
- The drift guard must parse the hook's actual `npm run` step list and compare against what CI invokes, including the indirect case where CI calls the underlying script path instead of the npm script name.
- The drift guard must be demonstrably failable: add a step to `.husky/pre-commit` in a scratch commit, show the guard goes red, then revert.
- State explicitly whether the reverse direction (a CI check not in the hook) matters — expected answer is "no, don't gold-plate it," but say so.
- Watch for scripts assuming a local-only environment (openspec CLI availability, node_modules layout, full checkout). If one can't run in CI as-is, that's a real design question to surface, not something to silently weaken.
- No migration expected; V107 is next free if one somehow becomes necessary — escalate before committing one.
