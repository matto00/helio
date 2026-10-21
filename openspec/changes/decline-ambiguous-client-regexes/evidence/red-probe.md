# Task 1.1 red probe (unmodified tree, before any javaRegex.ts change)

Command: `DEV_PORT=7115 BACKEND_PORT=10022 nice -n 19 flock ... npx playwright test e2e/hel1683-regex-main-thread.spec.ts --workers=1 --trace retain-on-failure`
Spec: `e2e/hel1683-regex-main-thread.spec.ts`; 5 rows of "a"x28+"!"; pattern entered in one `fill`.

- Control `(\d+)` (client-evaluated: no draft-preview request, "5 rows" rendered): longest long task **0.0 ms** (no long task).
- Probe `^(.*.*.*.*.*.*.*.*x)`: longest long task **825.0 ms** (single task).

Failure is the assertion, not a timeout:

    Error: probe pattern ^(.*.*.*.*.*.*.*.*x): longest main-thread task was 825.0 ms, must be <= 100 ms (control 0.0 ms)
    Expected: <= 100   Received: 825

Test user was deleted by the e2e global teardown (recorded id).
