## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 97ec3c746fbca19e93f8a57c94d53b8953a3b4cd. Diff base: 11924a56cef6638e3b84eecf187c783801e5c87e,
resolved live with `resolve-review-base.sh`. The evaluator re-ran every claim below. None of them rests on the
executor's evidence files. Evaluator scratch: `.../scratchpad/hel1425-eval-*`.

### Phase 1: Spec Review — PASS
Issues: none.

- **AC1 (guard):** `logicalLines` matches D1 verbatim (`scripts/check-ci-sbt-no-pattern-kill.mjs:30-49`).
  - **Red-first, re-run here.** I ran the new selftest against the base guard (`git show 11924a56c:...`) in a scratch
    tree. Exactly the 3 new flag cases FAIL: "trailing | then a blank line then grep", "... whitespace-only line ...",
    "blank-line split reports the FIRST physical line number". Every other case is ok, including the new backslash
    allow case.
  - **Mutation, re-run here.** Changing `afterOperator = continues;` turns exactly one case red: "allows (split):
    backslash then a blank line ends the command". So the allow case can fail.
  - **Real tree.** The selftest has 29 cases, all ok (rc 0). `npm run check:ci-sbt-guard` passes ("4 files
    scanned").
  - **Extra probes.** `&&` + blank lines and `||` + 2 blank lines are flagged. A comment followed by a blank line
    after `|` is flagged. `ps x\n\ngrep y` with no operator is allowed. A trailing `|` at EOF followed by blanks does
    not crash.
- **AC2 (split):**
  - Five scenario modules plus the harness, all under 250 lines: 77/34/32/56/76/61. The runner is 27 lines (under the
    ~80 aggregator budget). The original was 282.
  - **Bodies are verbatim.** I diffed each module's function body against the original line ranges: (a)-(c) 64-121,
    (d) 123+134-157, (e) 158-180, (f)(g) 182-216, (h) 218-277. All are identical. The one difference is in
    deadline.mjs, where `let r = run(` became `r = run(`, as D2 specifies.
  - **Harness differs from original lines 22-61 + 124-133 in exactly four ways:** `root` gains a `".."`; `export`
    was added; prettier re-wrapped `recordedPid`; `failures` was added and `e2eEnv` was de-indented. Lines 1-5 of the
    runner header are identical.
  - **Before/after run.** I generated the before run from the base file, `git show 11924a56c:scripts/ci-sbt.selftest.mjs`,
    in a scratch tree. The scripts it drives (ci-sbt.sh, e2e-backend.sh, lib/ci-sbt-diag.sh) are unchanged
    base..HEAD. The after run used `npm run selftest:ci-sbt` with cwd = worktree. Both runs show 26 checks and
    rc 0. With seconds normalised, the diff is empty.
  - **No leaks.** No `/tmp/ci-sbt-selftest-*` directories were left behind.
- **AC3 (ci.yml comment):**
  - The block matches D3 verbatim and still states the 660 s deadline. `about 30 s` no longer appears.
  - **Numbers checked against CI** with `gh api`, for the 10 completed ci.yml runs with ids 38015649444..38020588117,
    job `backend (0)`:
    - pre-steps: 66-87 s
    - selftest: 41-42 s
    - post-steps: 5-10 s, excluding run 38018116781 at 34 s (main-only cache saves)
  - **The exclusion holds.** Those saves are `if: github.event_name == 'push' && ...` without `always()`, so they are
    skipped on failure. `timeout-minutes: 13` (step) and `15` (job) are unchanged.
- **Tasks:** all tasks are `[x]` and match the diff.
- **Scope:** no scope creep. No product code changed, and no workflow behaviour changed (the ci.yml change is a
  comment only).
- **Spec delta:** the MODIFIED requirement equals the living requirement plus the two new AND lines.
  `openspec validate --strict` passes.
- **CONSTRAINTS C1/C2:** honored. No assertion, regex, name string or order changed.
- **Commit message:** `HEL-1425 ...` with a `Co-Authored-By` trailer only. It has no claude.ai session link and no
  `Claude-Session` trailer.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Gates, run here with cwd = worktree:**
  - `npm run lint`: rc 0
  - `npm run format:check`: rc 0
  - `npx eslint --max-warnings=0` on the 9 changed .mjs files: rc 0. `--print-config` confirms they are not ignored.
  - `npx prettier --check` on the changed .mjs, ci.yml and change-dir .md files: clean
- **Not run.** No `frontend/**` or `backend/**` files changed, so `npm test`, the frontend build and `sbt testFull`
  were not triggered.
- **Module state is safe.** `failed` stays module-private in the harness and is read through `failures()`. ESM
  evaluates the harness once, so all scenarios share one counter.
- **Evaluation-order change is benign.** `e2eEnv` is now built when the harness is imported rather than after
  scenario (c). It is pure data (paths and strings) with no side effects.
- **Error paths are unchanged.** The runner's `try/finally` still removes `tmp`. A thrown scenario stops later
  scenarios, the same as before.

### Phase 3: UI Review — N/A
No triggers: no frontend/**, ApiRoutes.scala, schemas/** or openspec/specs/** files changed. Dev servers were not
started.

### Overall: PASS

### Non-blocking Suggestions
- `scripts/check-ci-sbt-no-pattern-kill.mjs:29`: the `logicalLines` comment is now a single 219-character line. The
  file's other comments wrap at about 120 characters. Wrapping it would keep it readable. No mechanical rule covers
  this.
- `scripts/check-ci-sbt-no-pattern-kill.mjs:6`: D1 said to append the HEL-1425 sentence to the HEL-1362 sentence. The
  executor put it on its own comment line instead. The text is exact, so this is cosmetic.
