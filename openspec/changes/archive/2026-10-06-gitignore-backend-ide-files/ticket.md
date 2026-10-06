# HEL-1292: Gitignore backend/.jvmopts and backend/project IDE files (metals.sbt regression from #773)

## Description

Since HEL-1273, the CI backend "Compile and test" step writes an untracked `backend/.jvmopts` (`-Xmx3g`) to raise the sbt heap on CI only. `backend/.sbtopts` is deliberately unchanged. Nothing stops a local copy of `.jvmopts` from being committed by accident, and a committed copy would silently change every developer's and every worktree's sbt heap.

**Scope addition (owner, 2026-10-06), from HEL-1287:** matto00/helio#773 narrowed the `backend/project/` ignore, and `backend/project/metals.sbt` now shows as untracked in a main checkout. Ignore `metals.sbt` and any other IDE-generated files under `backend/project/`, without re-ignoring the tracked `TestShards.scala`, `gen-test-suite-weights.py` and `test-suite-weights.tsv`.

## Acceptance Criteria

- `backend/.jvmopts` is listed in `.gitignore`; `git check-ignore -v` confirms it is ignored.
- `backend/project/metals.sbt` and every other IDE-generated path that actually occurs under `backend/project/` (verified, not assumed: `.bloop/`, `project/`, `target/`; `.bsp/`/`.metals/` if they occur) is ignored, confirmed by `git check-ignore -v`.
- `git ls-files backend/project` still lists every currently tracked file: `TestShards.scala`, `build.properties`, `gen-test-suite-weights.py`, `plugins.sbt`, `test-suite-weights.tsv`.
- Red-to-green: `git status --porcelain` in a checkout where `backend/project/metals.sbt` exists shows `?? backend/project/metals.sbt` before the change and nothing for it after.
- Only `.gitignore` changes in source terms (OpenSpec workflow artifacts aside). The owner's `backend/project/metals.sbt` in the main checkout is never deleted or modified.

## Driver constraints

- Do not touch `.github/workflows/ci.yml`, `playwright.config.ts`, or e2e specs (owned by parallel lanes HEL-1288 / HEL-1300).
- At most one CI run at a time.
- Backend `testFull` is skipped: a `.gitignore`-only change cannot affect compilation or tests.
