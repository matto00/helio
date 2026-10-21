# Task 1.2 red Jest (unmodified javaRegex.ts)

`HELIO_JEST_MAX_WORKERS=2 npx jest src/features/pipelines/evaluator/javaRegex.test.ts`

    Tests:       16 failed, 44 passed, 60 total

All 16 failures are the new "declines ..." cases of `backtracking-prone patterns (HEL-1683)`
(`expect(accepted(p)).toBe(false)`: Expected false, Received true); the 6 "accepts ..." fenced cases already pass.
