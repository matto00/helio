## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 11924a56cef6638e3b84eecf187c783801e5c87e (branch task/ci-sbt-diagnostics-nits/HEL-1425). The change dir is untracked.
Scratch evidence: /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sk2/

### What I verified (with evidence)

**Round-1 CR1 (top-level `const` list): fixed.**
- I read scripts/ci-sbt.selftest.mjs myself. The top-level `const` lines are exactly 22, 23, 24, 26, 30, 32, 33, 34, 41, 47, 48, 52, 54, 60 and 61.
- Line 25 is `let failed`, which stays module-private.
- Line 42 (`const p`) is inside `standIn`.
- D2 now lists those lines and says line 42 is unchanged.

**Round-1 CR2 (import lists pinned): fixed, and the lists are correct.**
- D2 now pins all five scenario import lists, the harness imports, the scenario function names and the runner text.
- I checked the lists by building the split rather than by reading it. In scratch I built the seven files from the original line ranges, exactly as D2 says (sk2/x/scripts/ci-sbt-selftest/*, sk2/x/scripts/ci-sbt.selftest.mjs).
  - `node --check` passes on all seven files.
  - `eslint --max-warnings 0` (repo config, 9.39.3) gives exit 0.
  - The lint check can fail: I removed `alive` from deadline.mjs's import, and eslint then reported 2 errors.
- I ran the original and the split selftest and compared the output.
  - The original is the worktree file and produced sk2/before.txt. The split produced sk2/after.txt.
  - After normalising decimal seconds, `diff` is IDENTICAL.
  - Both runs have 26 checks, end with "all ci-sbt checks passed", and exit 0.
- The line ranges cover the file: 64-121, 123 + 134-157, 158-180, 182-216 and 218-277. Lines 124-133 go to the harness as `e2eEnv`.
- Line counts: runner 16, harness 57, and the largest scenario module is 68 (before prettier). All are under 250.

**D1 (bash semantics, red-first): sound.**
- Bash, checked by running it:
  - `echo a |`, then a blank line and a whitespace-only line, then `cat`: these join. `&&` and `||` across a blank line also join.
  - `echo d \`, then a blank line, then `| cat`: bash reports `syntax error near unexpected token '|'`. So `\` followed by a blank line ends the command.
- I applied the D1 `logicalLines` body verbatim to a scratch copy, with the four selftest cases added at the two anchors. Both anchors exist verbatim, at selftest lines 38 and 51.
  - Old guard: exactly the 3 new flag cases FAIL. This is the red-first check.
  - New guard: no FAILs, and `check-ci-sbt-no-pattern-kill: ok (4 files scanned)` runs over copies of the real scanned files, including ci.yml.
  - Mutation `afterOperator = continues;`: only "allows (split): backslash then a blank line ends the command" FAILs.
- The comment-line `return` comes before the blank-skip, so `afterOperator` carries across comment lines, as it should.

**D3 (numbers): verified against `gh api .../actions/runs/<id>/jobs`, job `backend (0)`.**
- I covered the 10 cited runs, 38015649444..38020588117.
  - Pre-steps: 87, 66, 87, 80, 72, 70, 81, 71, 79, 79, so the range is 66-87.
  - Post-steps: 5-10, excluding main push 38018116781 at 34 s, where the three "(main only)" save/prune steps took 12+4+9 s.
  - Selftest: 41-42 s. JUnit upload: 2-3 s.
- Arithmetic: 87 + 780 + 10 = 877, which is 23 s under 900. "About 20 s to spare" is accurate.
- ci.yml lines 245-249 are exactly the block being replaced. It runs from `# HEL-1339: sbt runs through` to `about 30 s to spare.`.
- A newer completed run, 38021130394 (a main push, post 22 s, which includes the 16 s of main-only saves), has appeared since. It does not change the cited window or the conclusion.

**Scope / AC coverage:**
- AC1 → D1 and tasks 2.x. AC2 → D2 and tasks 1.x/3.x. AC3 → D3 and task 4.1.
- The spec delta adds a single AND clause to the Static guard scenario.
- I found no placeholders, contradictions or scope drift.

### Verdict: CONFIRM

### Non-blocking notes
- The D2 runner's one-line `try { ... } finally { ... }` will be reformatted by task 3.3's prettier run. That is expected.
- The harness exports `elsewhere`, but no scenario imports it. That is harmless: eslint does not flag unused exports.
- Appending the HEL-1425 sentence to guard header line 5 makes an already-long comment line longer. Prettier does not reflow comments, so this is cosmetic only.
