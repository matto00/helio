# HEL-1425: CI sbt diagnostics nits after HEL-1362: guard pipe+blank-line spelling, split ci-sbt.selftest.mjs, margin comment accuracy

## Description

origin_kind: followup
origin_ticket: HEL-1362 (PR matto00/helio#869). Verify each.

1. The ci.yml guard misses a pipe followed by a blank line before `grep` (valid bash, unlikely spelling). Extend the
   guard and its selftest.
2. `scripts/ci-sbt.selftest.mjs` is 282 lines, over the ~250 soft budget. Split it by scenario.
3. The ci.yml "about 30 s to spare" margin comment leaves out ~6–7 s of steps after "Compile and test". Correct it (a
   hang is still stopped by the 660 s deadline).

## Acceptance Criteria

- AC1: `scripts/check-ci-sbt-no-pattern-kill.mjs` flags a `ps ... |` pipeline whose `grep` follows one or more blank
  (or whitespace-only) lines; a selftest case for it fails against the old guard (red-first) and passes after. A
  backslash continuation followed by a blank line is still NOT joined (bash ends the command there). The real tree
  stays clean.
- AC2: `scripts/ci-sbt.selftest.mjs` is split by scenario into files each under ~250 lines; `npm run selftest:ci-sbt`
  (unchanged entry point) runs exactly the same checks, same names, same order, same count, before and after.
- AC3: the ci.yml "Compile and test" margin comment includes post-step time, with numbers measured on current CI runs
  (run ids cited), and still states that a hang is stopped by the 660 s deadline.
