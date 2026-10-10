## Standing Constraints

- [C1] Exact text and line ranges come from design.md D1-D3; do not change any assertion, regex, name string or order.
- [C2] Run every command with `git -C`/absolute paths; scratch output goes to /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1425-*.

## 1. Baseline (before any edit)

- [x] 1.1 Run `npm --prefix /home/matt/Development/helio/.claude/worktrees/task/ci-sbt-diagnostics-nits/HEL-1425 run selftest:ci-sbt > /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1425-selftest-before.txt 2>&1`; verify it ends "all ci-sbt checks passed"
- [x] 1.2 Record `wc -l` of scripts/ci-sbt.selftest.mjs (282) and `grep -cE '^(ok  |FAIL)' ` of the before file

## 2. Guard: blank line after an operator (item 1, red-first)

- [x] 2.1 Add the four D1 selftest cases to scripts/check-ci-sbt-no-pattern-kill.selftest.mjs only
- [x] 2.2 Run `node scripts/check-ci-sbt-no-pattern-kill.selftest.mjs`; save to /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1425-guard-red.txt; verify exactly the 3 new flag cases FAIL
- [x] 2.3 Apply the D1 `logicalLines` change and the two comment edits; rerun selftest -> all ok, and `npm run check:ci-sbt-guard` -> ok
- [x] 2.4 Mutation: set `afterOperator = continues;`, rerun selftest, verify the backslash allow case FAILs (save /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1425-guard-mutation.txt); revert

## 3. Split ci-sbt.selftest.mjs (item 2)

- [x] 3.1 Create scripts/ci-sbt-selftest/harness.mjs exactly per D2
- [x] 3.2 Create deadline.mjs, e2e-die.mjs, no-client-mode.mjs, sigquit-only.mjs, capture-budget.mjs per D2
- [x] 3.3 Rewrite scripts/ci-sbt.selftest.mjs as the D2 runner; `npx prettier --write` the 7 files; `npx eslint` them -> 0 warnings
- [x] 3.4 Run selftest to /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1425-selftest-after.txt; normalise both files with `sed -E 's/[0-9]+\.[0-9]+s/Ns/g'`; `diff` must be empty
- [x] 3.5 Verify every file under scripts/ci-sbt-selftest/ and the runner is under 250 lines (`wc -l`)

## 4. Margin comment (item 3)

- [x] 4.1 Replace .github/workflows/ci.yml lines 245-249 with the D3 block; verify `grep -n "about 30 s" .github/workflows/ci.yml` is empty and `npx prettier --check .github/workflows/ci.yml` passes

## 5. Commit

- [x] 5.1 `free -g` (wait if available < ~15 GB); commit "HEL-1425 ..." through the normal hook (no --no-verify); list evidence paths in files-modified.md
