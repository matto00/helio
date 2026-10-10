- `.github/workflows/ci.yml` — D3 margin comment on "Compile and test" corrected (post-step time, measured run ids, 660 s deadline still stated); comment-only
- `scripts/check-ci-sbt-no-pattern-kill.mjs` — `logicalLines` skips blank lines only after a trailing `|`/`||`/`&&` (not after `\`); header and comment updated (D1)
- `scripts/check-ci-sbt-no-pattern-kill.selftest.mjs` — four D1 cases: three blank-line-after-operator flag cases (red against the old guard) and one backslash-then-blank allow case (mutation-failable)
- `scripts/ci-sbt.selftest.mjs` — now the runner (D2): same header, imports the five scenario modules and runs them in (a)-(h) order; same final summary and exit code
- `scripts/ci-sbt-selftest/harness.mjs` — shared harness moved out of the original file (D2): helpers, `tmp`, stand-ins, and the `e2eEnv` block, exported
- `scripts/ci-sbt-selftest/deadline.mjs` — scenarios (a)-(c), moved verbatim
- `scripts/ci-sbt-selftest/e2e-die.mjs` — scenario (d), moved verbatim
- `scripts/ci-sbt-selftest/no-client-mode.mjs` — scenario (e), moved verbatim
- `scripts/ci-sbt-selftest/sigquit-only.mjs` — scenarios (f)-(g), moved verbatim
- `scripts/ci-sbt-selftest/capture-budget.mjs` — scenario (h), moved verbatim

Evidence (scratch dir `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/`): `hel1425-selftest-before.txt`, `hel1425-selftest-after.txt`, `hel1425-selftest-diff.txt` (empty), `hel1425-guard-red.txt`, `hel1425-guard-mutation.txt`, `hel1425-wc.txt`.
