## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `97ec3c746fbca19e93f8a57c94d53b8953a3b4cd`. The diff base was resolved live with `resolve-review-base.sh`
(main/origin) and came back as `11924a56cef6638e3b84eecf187c783801e5c87e`. Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**AC1: guard handles blank lines after a pipe**
- Red-first check. I put the base guard (`git show 11924a56c:scripts/check-ci-sbt-no-pattern-kill.mjs`) next to the NEW
  selftest in a scratch copy, together with copies of the 4 scanned files. Exit 1, with exactly 3 FAILs, all from the new
  cases: "trailing | then a blank line then grep", "trailing | then a whitespace-only line then grep" and "blank-line
  split reports the FIRST physical line number".
- Mutation check of the backslash allow case. I changed `afterOperator = continues && !backslash;` to
  `afterOperator = continues;`. Exit 1, with a single FAIL: "allows (split): backslash then a blank line ends the
  command". The same scratch copy without the mutation exits 0.
- The worktree itself: the guard selftest prints 29 lines, none of them FAIL, and exits 0. `node
  scripts/check-ci-sbt-no-pattern-kill.mjs` prints `ok (4 files scanned)` and exits 0, so the real tree is clean.
- I confirmed the bash behaviour the guard models. `echo a |` followed by blank and whitespace-only lines and then
  `cat -A` prints `a$`. `&&` followed by a blank line continues. `\` followed by a blank line and then `| cat` is a
  syntax error, so the command ends there.

**AC2: selftest split**
- Baseline: I ran `11924a56c:scripts/ci-sbt.selftest.mjs` in a scratch root, with copies of `ci-sbt.sh`,
  `e2e-backend.sh` and `lib/ci-sbt-diag.sh`. `git diff --quiet` shows those 3 files are unchanged base→HEAD. Exit 0.
- After: `npm run selftest:ci-sbt` in the worktree. Exit 0, about 41 s.
- I normalised the `ok`/`FAIL` lines, masking only the "(measured …)" timings in (h). Both runs give 26 lines,
  `diff` says IDENTICAL, and there are 0 FAILs: same names, same order, same count.
- Bodies are verbatim. I joined the 5 module bodies in import order and diffed them against base lines 64–277. The only
  differences are mechanical:
  - `let r` moved into each function;
  - the `e2eEnv` literal moved to `harness.mjs`, and it is byte-identical there.
- `harness.mjs` matches base lines 22–61. `root` correctly goes up two directories (`"..", ".."`). `failed` is now
  read through `failures()`.
- Line counts (wc): entry file 27, harness 61, deadline 77, capture-budget 76, sigquit-only 56, e2e-die 34,
  no-client-mode 32. All are under 250.
- The entry point is unchanged (`package.json:19`), and CI still calls `npm run selftest:ci-sbt`.

**AC3: ci.yml margin comment**
- I fetched `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs` for the 10 completed ci.yml runs with ids from
  38015649444 to 38020588117 (I listed them through the workflow runs API) and used job `backend (0)`. The raw JSON is in
  the session scratchpad, `hel1425-fsk-ci/`.
- Pre-steps (job start to "Compile and test" start): 87, 66, 87, 80, 72, 70, 81, 71, 79, 79 s, so 66–87 ✓.
- Selftest step: 41–42 s ✓.
- Post-steps: 7, 8, 8, 7, 5, **34**, 7, 10, 8, 7 s. The 34 s is main push 38018116781, where Prune, Save compile and
  Save deps ran for 12, 4 and 9 s. Excluding it gives 5–10 ✓.
- JUnit upload: 2–3 s in every run ✓.
- Arithmetic: 87 + 780 + 10 = 877, and 900 − 877 = 23, which matches "about 20 s to spare" ✓. A hang is stopped at
  660 + 25 + 5 = 690 s, which is under the 780 s step bound. 87 + 690 + 10 = 787, which is under the 900 s job bound ✓.
- "Saves skipped on failure": all 3 main-only steps (ci.yml ~264–290) have an `if:` with no
  `always()`/`failure()`, so the default `success()` skips them after a failed step ✓.
- The comment correctly says the `failure()`-only diagnostics upload is unmeasured.
- Nothing else in ci.yml changed. The diff is a single hunk. Filtering the +/- lines to non-comment lines leaves 0, so
  `timeout-minutes: 13` and the `run:` lines are unchanged.

**Hygiene**
- Prettier `--check` and `eslint --max-warnings 0`, run from the worktree on every changed script plus ci.yml: both exit
  0.
- `npm run check:openspec`: `openspec/ is clean`.
- tasks.md has 0 unchecked tasks.
- The spec delta, diffed against the living requirement, only adds the AND clause about blank lines. Every other
  scenario is kept.
- The commit message has no claude.ai link, `Claude-Session` trailer, or "session" text: `grep -niE 'claude.ai|session'`
  exits 1. Its only trailer is `Co-Authored-By`.

No UI or backend changes, so no servers were started and there is no design judgment to make.

### Verdict: CONFIRM

### Non-blocking notes
- ci.yml comment, "HEL-1425, shard 0 of 10 runs 38015649444..38020588117": "shard 0 of 10" can be misread as 10 shards
  (the matrix has 4). "Shard 0 in 10 runs" would avoid that.
- `evaluation-1.md` is untracked in the change dir. That is for the orchestrator to handle at archive/commit time.
