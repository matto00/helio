# Gates (task 4.2), run in the worktree after the final commit

- `sbt testFull` (backend, -J-Xmx3g, nice 19): `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`,
  `Tests: succeeded 9465, failed 0, canceled 5, ignored 0, pending 0`, `All tests passed.`, exit 0.
  (An earlier full run had 2 failures in GenerateTextStepSpec: fixed by keeping a blank `end_turn` as
  the step's own `response-empty` reason, see ClaudeAiStepClient.)
- `npm run lint`: exit 0, zero warnings. `npm run format:check`: all files formatted. `npm run typecheck`: clean.
- `npm test` (jest, run by the pre-commit hook on the final commit): `Test Suites: 764 passed`, `Tests: 9403 passed`.
- `npm --prefix frontend run build`: exit 0. `npm run check:openspec`: `openspec/ is clean` (after merging origin/main).

## Cycle 2 re-gate
- sbt testFull on merged head: Tests: succeeded 9569, failed 0, canceled 5; All tests passed; exit 0.
- Pre-commit hook on the merge commit: frontend lint/tsc/prettier, jest 765 suites / 9407 tests passed.
