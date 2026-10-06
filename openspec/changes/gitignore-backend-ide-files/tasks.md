## 1. Red baseline

- [x] 1.1 In the worktree, before editing `.gitignore`, create `backend/project/metals.sbt` and `backend/.jvmopts` at those exact paths and record `git status --porcelain` showing both as `??`; verify by saving the output as evidence.

## 2. Implementation

- [x] 2.1 Add `backend/project/metals.sbt` to the #773 `backend/project/` block and `backend/.jvmopts` beside the other `backend/.*` rules in `.gitignore`; verify with `git diff --stat` showing only `.gitignore` changed outside `openspec/`.

## 3. Verification

- [x] 3.1 Re-run `git status --porcelain` with the planted files still present and confirm neither path appears; verify by saving the output as evidence.
- [x] 3.2 Run `git check-ignore -v --no-index` on every IDE path in design.md's Verification Plan, directory-only rules via a child path (each reports a rule), plus index-aware `git check-ignore -v` on the two planted files, and on the five tracked files plus `backend/project/NewBuildSource.scala` (each prints nothing); verify by saving the output as evidence.
- [x] 3.3 Run `git ls-files backend/project` and confirm all five tracked files are listed; verify by saving the output as evidence.
- [x] 3.4 Remove the two planted files by exact path (`rm backend/project/metals.sbt backend/.jvmopts` inside the worktree only) and confirm `git status --porcelain` is clean apart from the commit's own changes.
