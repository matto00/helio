## Standing Constraints

- [C1] Comment-only: the only source file changed is `backend/src/main/scala/com/helio/domain/model/Panel.scala`, and
  only scaladoc lines in it change. `git diff --stat` touches nothing else outside
  `openspec/changes/panelkind-scaladoc-drift-surface/`.
- [C2] Every claim in the new comments is backed by a command in design.md "Claim → proof" whose actual output is
  pasted into `files-modified.md` (or the executor report).

Worktree root (use absolute paths; shell variables do not persist between separate Bash calls):
`/home/matt/Development/helio/.claude/worktrees/task/panelkind-scaladoc-drift-surface/HEL-1156`

### 1. Edit

- [x] 1.1 Open `backend/src/main/scala/com/helio/domain/model/Panel.scala` (absolute path under the worktree root) and
  apply design.md edits E1, E2, E3, E4, E5 verbatim with the Edit tool: each OLD block → its NEW block. Each OLD block
  occurs exactly once. Do not change any line that is not part of an OLD block. Do not reformat, do not run
  scalafmt.

### 2. Acceptance-criteria proofs (paste each command + its real output)

Run each from the worktree root (`cd <worktree root> && <command>` in ONE Bash call):

- [x] 2.1 AC1: `grep -n -i "only requires updating" backend/src/main/scala/com/helio/domain/model/Panel.scala` prints
  nothing (exit status 1). Positive control first: `git show origin/main:backend/src/main/scala/com/helio/domain/model/Panel.scala | grep -c -i "only requires updating"` prints `1`.
- [x] 2.2 AC2:
  - `grep -c "Drift surface for a new panel kind" backend/src/main/scala/com/helio/domain/model/Panel.scala` prints `1`
  - `grep -c "docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md" backend/src/main/scala/com/helio/domain/model/Panel.scala` prints `1`
  - `grep -n "source of truth for \[\[parseKind\]\] and" backend/src/main/scala/com/helio/domain/model/Panel.scala` prints 1 line
  - `grep -n -i "this set ONLY" backend/src/main/scala/com/helio/domain/model/Panel.scala` prints 1 line
  - the old overclaims are gone. First command (positive control on the old file) prints `8`; second (new file) prints
    nothing, exit status 1:

    ```bash
    git show origin/main:backend/src/main/scala/com/helio/domain/model/Panel.scala | grep -c -i -E 'only requires updating|single source of truth|8th panel kind|derives from this Map|round-trip through the|panels\.type|Source of truth for the panel-type'
    grep -n -i -E 'only requires updating|single source of truth|8th panel kind|derives from this Map|round-trip through the|panels\.type|Source of truth for the panel-type' backend/src/main/scala/com/helio/domain/model/Panel.scala
    ```
  - `grep -c "git grep -l -i divider -- backend/src/main frontend/src helio-mcp/src schemas" backend/src/main/scala/com/helio/domain/model/Panel.scala` prints `1` (E4's recipe is the unquoted form proven by P10)
- [x] 2.3 AC3 (comment-only). Run:
  `git diff -U0 -- backend/src/main/scala/com/helio/domain/model/Panel.scala | grep -E '^[-+]' | grep -v -E '^(\+\+\+|---)' | grep -v -E '^[-+][[:space:]]*(\*|/\*\*)'`
  Expected: prints nothing (every changed line is a scaladoc line). Also run
  `git diff --stat` — expected: only `backend/src/main/scala/com/helio/domain/model/Panel.scala` (plus files under
  `openspec/changes/panelkind-scaladoc-drift-surface/` if they show as changed/untracked; use `git status --short`).
  (Run these BEFORE committing; after committing use `git diff -U0 origin/main...HEAD -- <same path>` instead.)
- [x] 2.4 Claim proofs: run every command in design.md "Claim → proof" (P1–P10, incl. the P10 negative control) and paste each command with its actual
  output. If any output differs from the stated expectation, STOP and report it as a finding — do not edit the
  comment to match on your own.

### 3. Compile / test

- [x] 3.1 From `<worktree root>/backend`, in one Bash call with a 600000 ms timeout:
  `cd /home/matt/Development/helio/.claude/worktrees/task/panelkind-scaladoc-drift-surface/HEL-1156/backend && nice -n 19 sbt "testOnly com.helio.domain.model.PanelSpec"`
  Expected: compiles; PanelSpec reports all tests passed (0 failed). Never bare `sbt test`.
- [x] 3.2 `cd <worktree root> && openspec validate panelkind-scaladoc-drift-surface --type change` exits 0.

### 4. Commit

- [x] 4.1 Stage `backend/src/main/scala/com/helio/domain/model/Panel.scala` and the
  `openspec/changes/panelkind-scaladoc-drift-surface/` directory (by explicit path — never `git add -A`), then commit
  with exactly this message (Husky pre-commit hooks must run; no `--no-verify`, no `HUSKY=0`; Bash timeout 600000):

  ```
  HEL-1156 Correct Panel.Registry / PanelKind.All scaladoc overclaim

  The registry is the source of truth for PanelKind.All, parseKind and
  companionFor only; adding a kind also needs many hand-enumerated sites
  (spec "Drift surface for a new panel kind" paragraph, re-derived from the
  tree). Comment-only.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- [x] 4.2 Do not use `git stash` (shared across worktrees). Do not touch the main checkout.
