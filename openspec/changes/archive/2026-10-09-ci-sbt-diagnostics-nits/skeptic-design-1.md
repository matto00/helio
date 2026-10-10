## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 11924a56cef6638e3b84eecf187c783801e5c87e (branch task/ci-sbt-diagnostics-nits/HEL-1425; change dir untracked).
Scratch evidence: /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sk/

### What I verified (with evidence)

**D1 (item 1): correct, and the new cases go red against the old guard.**
- Bash semantics, checked with a script rather than recalled: `echo a |`, a blank line, a whitespace-only line, then `cat`; `true &&` + blank + `echo b`; `false ||` + blank + `echo c`. All three join. `echo d \` + blank + `| cat` ends the command after `\`, so the next line is `syntax error near unexpected token '|'`. Skipping blanks only after an operator, and never after `\`, matches bash.
- I copied the guard to scratch with the D1 `logicalLines` body verbatim (old-guard.mjs / new-guard.mjs / mut-guard.mjs). I copied the selftest with the four D1 cases inserted at the stated anchors (st-{old,new,mut}.mjs). Results, 29 checks each:
  - old guard: exactly the 3 new flag cases FAIL. This is the red-first check.
  - new guard: all ok, including "real tree is clean" over the 4 real SCANNED files.
  - mutation (`afterOperator = continues;`): only "allows (split): backslash then a blank line ends the command" FAILs. The allow case can fail, as claimed.
- Both anchor strings exist verbatim in scripts/check-ci-sbt-no-pattern-kill.selftest.mjs (lines 38 and 51).

**D2 (item 2): the line accounting is complete and exact, but two instructions are not pinned well enough for Haiku (CR1, CR2).**
- I walked all 282 lines of scripts/ci-sbt.selftest.mjs:
  - Header: 1-5.
  - Imports: 6-20. Redistributed to the new files.
  - Blank lines dropped: 21, 62, 122, 181, 217. Also line 63 `try {`, which is replaced by the runner's try.
  - Harness: 22-61. Scenarios (a)-(c): 64-121. Comment at 123; e2eEnv at 124-133, which goes to the harness. Scenario (d): 134-157. Scenario (e): 158-180. Scenarios (f)-(g): 182-216. Scenario (h): 218-277.
  - Runner: 278-282.
  - No line is lost or used twice.
- There is no hidden state shared across scenarios. Locals m/mc/pgid/pgidE/mf/shim/shimEnv/gid all stay inside one module. `shimEnv` crosses (f) and (g), and both are in sigquit-only.mjs.
- The only `r` declaration is `let r` at line 65. Each module's `let r;` plus "65 becomes `r = run(`" means no redeclaration.
- The harness import list in D2 is exact. Every name is used in 22-61 and nothing is missing: spawnSync is used in alive/run, chmodSync in standIn, dirname in root.
- Moving e2eEnv earlier has no side effect, because it only builds an object out of join/diag.
- The harness's top-level setup (mkdtempSync etc.) still runs before the try, as the original lines 32-52 did.
- `failures()` reads the module-private `failed` live, so the count is right.
- root = `..`,`..` from scripts/ci-sbt-selftest/ resolves to the repo root, so CI_SBT, E2E and capture-budget's lib path stay correct.
- Line budget: the biggest module, capture-budget, is about 65 lines. All files stay well under 250.
- Linting: eslint.config.cjs applies js.configs.recommended to `**/*.mjs`, with node globals, so `performance` is fine. no-unused-vars and no-undef are therefore active. Both `npx --no-install eslint` (9.39.3) and `prettier` (3.8.1) resolve from the worktree.
- Behaviour-preservation proof: diffing stdout before and after, with `[0-9]+\.[0-9]+s` normalised, is sound for this purpose. Only (h)'s name contains timings ("budget 6s" has no decimal, so it survives normalisation). A dropped, renamed or reordered check, or a changed count, shows up as a diff. The spawned children's stderr is captured by spawnSync and never inherited, so `2>&1` adds nothing that varies between runs.

**D3 (item 3): numbers re-derived independently. They are correct.**
- I ran `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs` over the 10 most recent completed ci.yml runs, 38015649444..38020588117, and took job `backend (0)`:
  - Pre-steps (job start to "Compile and test" start): 79, 79, 71, 81, 70, 72, 80, 87, 66, 87. The range is 66-87 ✓.
  - Post-steps ("Compile and test" end to job end): 7, 8, 10, 7, 34, 5, 7, 8, 8, 7. The 34 s is main push 38018116781, where the 3 main-only saves ran (12 + 4 + 9 s). Excluding it, the range is 5-10 ✓. The 10 s run, 38018848662, is a main push whose saves were skipped.
  - Selftest step: 41-42 s ✓. Upload backend JUnit reports: 2-3 s ✓. "Upload sbt hang diagnostics" was skipped in every run, so it is unmeasured ✓.
  - Arithmetic: 87 + 780 + 10 = 877, which is 23 s under 900. "About 20 s to spare" is accurate.
- The three save steps' `if:` expressions are at ci.yml lines 266, 271 and 281. Each is `github.event_name == 'push' && github.ref == 'refs/heads/main' && matrix.shard == 0 && ...cache-hit != 'true'`. None contains a status function, so the implicit `success()` applies and they are skipped when "Compile and test" fails or times out. JUnit upload is `always()` (line 291) and is counted in post-steps. The diagnostics upload is `failure()` (line 299) and is disclosed as unmeasured. So "main-only saves excluded (skipped on failure)" is true.
- ci.yml lines 245-249 are exactly the comment block D3 replaces, starting at `# HEL-1339: sbt runs through` and ending at `about 30 s to spare.`. 660 s deadline, `timeout-minutes: 13` (line 250) and job `timeout-minutes: 15` (line 159) all match the comment.

**Spec delta:** a diff of the MODIFIED requirement against openspec/specs/ci-sbt-invocation/spec.md shows exactly one added AND line. The requirement is otherwise reproduced verbatim. **AC coverage:** AC1 is covered by D1 and tasks 2.x, AC2 by D2 and tasks 1.x/3.x, AC3 by D3 and task 4.1. There is no scope drift.

**Item 2 vs a pinned Haiku plan (question 4):** this is not too involved. It is mechanical range-cutting, with a deterministic oracle: parse errors, eslint no-undef/no-unused-vars, and the stdout diff. Its only real hazards are the two loosely worded instructions below. With them pinned, Haiku can execute it. Without them, the literal text produces invalid code (CR1) or leaves Haiku to work out 5 import lists on its own (CR2).

### Verdict: REFUTE

### Change Requests

1. **design.md D2, harness bullet: "every `const` becomes `export const`" is literally wrong.** Line 42 (`  const p = join(tmp, name);`) is a `const` inside the `standIn` body. `export` there is a syntax error. Reword to: "every TOP-LEVEL `const` (original lines 22, 23, 24, 26, 30, 32, 33, 34, 41, 47, 48, 52, 54, 60, 61) becomes `export const`; line 42's `const p` inside `standIn` is unchanged."
2. **design.md D2: pin each scenario module's import list exactly.** Right now it says "imports of exactly the names it uses", which a pinned Haiku plan should not leave open. These are the lists I derived from the ranges, checked mechanically. A regex false positive was hand-corrected: `backend` appears in (d) only inside the `/e2e-backend: mode=server /` regex literal.
   - deadline.mjs: harness `{ run, CI_SBT, backend, hang, hangWrongCwd, fast, diag, recordedPid, check, alive }`; node:fs `{ existsSync, readFileSync, readdirSync }`; node:path `{ join }`.
   - e2e-die.mjs: harness `{ run, E2E, e2eEnv, tmp, diag, check, alive }`; node:fs `{ existsSync, readFileSync }`; node:child_process `{ spawnSync }`; node:path `{ join }`.
   - no-client-mode.mjs: harness `{ run, CI_SBT, E2E, e2eEnv, backend, fast, tmp, diag, check }`; node:fs `{ readFileSync }`; node:child_process `{ spawnSync }`; node:path `{ join }`.
   - sigquit-only.mjs: harness `{ run, CI_SBT, E2E, e2eEnv, backend, hang, tmp, diag, recordedPid, check, alive }`; node:fs `{ mkdirSync, writeFileSync, chmodSync, readFileSync }`; node:child_process `{ spawnSync }`; node:path `{ join }`.
   - capture-budget.mjs: harness `{ root, tmp, backend, standIn, diag, check }`; node:fs `{ mkdirSync, writeFileSync, chmodSync, readdirSync, readFileSync, readlinkSync }`; node:child_process `{ spawn, spawnSync }`; node:path `{ join }`.

   The planner should re-verify these lists before pasting them. Task 3.3's eslint run then confirms them.

### Non-blocking notes

- D2 "header ... (reworded ...)" leaves the exact harness header text to the executor. That is harmless, but pinning one sentence would remove the last bit of judgment.
- D2's "(drop the leading `let`/`r =` mismatch: ...)" is confusingly worded. The rule that follows it (the first `let r = run(` becomes `r = run(`) is clear, so this is fine.
- The worktree has no root node_modules. eslint and prettier resolve by walking up to the main checkout's node_modules, which works. Note this if the evaluator expects worktree-local deps.
- Task 1.2's `grep -cE '^(ok  |FAIL)'` gives a check count. Task 3.4's diff already implies the count is unchanged, so 1.2 is redundant but harmless.
