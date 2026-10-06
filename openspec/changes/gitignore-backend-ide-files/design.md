## Context

See proposal.md - Why. State on `main` (e043566d1):

- `.gitignore` after #773 ignores `backend/project/target/`, `backend/project/project/`, `backend/project/.bloop/`, `backend/project/.bsp/`. The top-level patterns `.metals/`, `.bloop/`, `.bsp/`, `.idea` have no inner slash, so they already match at any depth.
- Tracked under `backend/project/`: `TestShards.scala`, `build.properties`, `gen-test-suite-weights.py`, `plugins.sbt`, `test-suite-weights.tsv` (five files; the ticket names three, but all five must stay tracked).
- IDE-generated paths observed in the main checkout's `backend/project/`: `metals.sbt` (unignored), `.bloop/`, `project/`, `target/` (all ignored). `.bsp/` and `.metals/` do not occur there but are covered anyway. Metals' nested `backend/project/project/metals.sbt` is covered by `backend/project/project/`.
- `.github/workflows/ci.yml:213` writes `backend/.jvmopts`; nothing ignores it.
- MISTAKES.md records why `backend/project/` was un-ignored: a new build source there stayed untracked and CI failed to compile.

## Goals / Non-Goals

**Goals:** ignore `backend/.jvmopts` and `backend/project/metals.sbt`; keep all five tracked files tracked; keep any future build source added to `backend/project/` visible to `git status`.

**Non-Goals:** changing CI's heap setting or `ci.yml` (owned by HEL-1288); deleting or editing the owner's `backend/project/metals.sbt`; ignoring IDE files outside `backend/`.

## Decisions

1. **Two exact-path rules, not a wildcard.** Add `backend/.jvmopts` and `backend/project/metals.sbt` as literal paths.
   - Rejected: `backend/project/*` with `!` negations for the tracked files. A new build source added later would be silently ignored, which is exactly the trap MISTAKES.md records.
   - Rejected: `backend/project/*.sbt`. It would match the tracked `plugins.sbt`; git keeps tracking it, but any new `.sbt` plugin file would be silently ignored.
   - Rejected: an unanchored `metals.sbt`. Metals only generates it under sbt `project/` directories; a repo-wide pattern is broader than the defect.
2. **Leave the existing #773 rules unchanged.** They already cover `.bloop/`, `.bsp/`, `project/`, `target/`; editing them adds risk for no gain.
3. **Placement.** Put `backend/project/metals.sbt` in the #773 block and `backend/.jvmopts` beside the other `backend/.*` entries, so related rules stay together.

## Risks / Trade-offs

- [Another IDE writes a different file into `backend/project/`] → It stays visible as untracked, the safe failure mode; add a rule when it is actually seen.
- [A future change wants to track `metals.sbt`] → Unlikely (machine-generated); would need `git add -f` or removing the rule.

## Verification Plan

- `git check-ignore -v --no-index` on `backend/.jvmopts`, `backend/project/metals.sbt`, `backend/project/project/metals.sbt`, `backend/project/.bloop/x`, `backend/project/.bsp/x`, `backend/project/.metals/x`, `backend/project/project/x`, `backend/project/target/x`: each must report a matching rule. Directory-only rules (`foo/`) are queried through a child path because `--no-index` on a non-existent path without a trailing slash does not match a directory-only pattern (design-gate round 1 note).
- `git check-ignore -v` (index-aware, no `--no-index`) on the planted `backend/.jvmopts` and `backend/project/metals.sbt`: each must report its rule.
- `git check-ignore -v --no-index` on each of the five tracked files and on a hypothetical new source (`backend/project/NewBuildSource.scala`): each must print nothing (exit 1).
- `git ls-files backend/project` lists all five tracked files.
- Red-to-green in the worktree: plant `backend/project/metals.sbt` and `backend/.jvmopts` at those exact paths, record `git status --porcelain` before (`??` lines present) and after the `.gitignore` edit (absent), then remove the two planted files by exact path. The main checkout's file is never touched.
