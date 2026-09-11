## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Scope: verify fix commit 4639b053 against skeptic-final-1.md CR1/CR2, plus fresh gates. AC tracing from round 1 still holds; the only production-code change since then is three `truncatedTo(ChronoUnit.MICROS)` calls (`git show HEAD -- backend/`).

### What I verified (with evidence)

**CR1: per-row updatedAt precision**
- Code: `DataSourceService.scala:744` (applyStaticRefresh), `:774` (appendRows), and `:794` (replaceRows) now pass `Instant.now().truncatedTo(ChronoUnit.MICROS)`. `RowWriteResponse.fromDomain` (DataSourceProtocol.scala:267) is only reached from these routes (DataSourceRoutes.scala:120,125), and the rows it serializes come only from `repo.appendRows`/`replaceRows`, which stamp every row with the passed `updatedAt`. No other row-write path feeds the response. `dataset_rows.updated_at` is `TIMESTAMPTZ` (V106:36).
- The regression tests (DataSourceRoutesSpec POST and PUT "matches the value actually stored…") read `updated_at` back from `dataset_rows` by row id and compare it with the response. They also assert equality with the source-level `updatedAt`.
- **Mutation (my own, scratch copy outside the worktree):** I reverted the truncation at :774 and :794. Both tests went red with exactly the defect I named in round 1: `"…17.974572[131]Z" was not equal to "…17.974572[]Z"` (POST) and `"…18.138686[077]Z"` vs `"…18.138686[]Z"` (PUT). The guard is real.

**CR2: schema-race test vacuity**
- The rewritten test (DataSourceRepositorySpec ~L549-579) uses schemas of different arity with required fields. PUT's row is valid under the old schema and invalid under the new one. It asserts that the final `columns` equals `newSchema.toJson` and the final `rows` equals refresh's rows. I reasoned through both lock orders and each yields that final state on correct code.
- **I re-applied round 1's Mutation B myself** (the one that let the old test pass 3 of 3). In the scratch copy, `replaceRows` reads `dataset_schema` *before* `lockSource` and does a 300ms `pg_sleep` on the PUT path. The new test FAILED 3 of 3: `[{"name":"a","required":false,…}] was not equal to [{"name":"a","required":true,…},{"name":"b",…}]` (L577). This is the silent-revert bug caught directly.
- Control on the unmutated code: 5 of 5 passes, so the test is not flaky.

**Fresh gates (run by me)**
- `cd backend && sbt test`: `Total number of tests run: 4138` / `succeeded 4138, failed 0` / `All tests passed.` / EXIT=0. That is round 1's 4136 plus the 2 new route tests.
- `npm run lint` EXIT=0, `npm run format:check` "All matched files use Prettier code style!", `npm run typecheck` EXIT=0. There is no frontend or schema diff since round 1 (`git diff 81c7d76c HEAD -- frontend schemas` is empty), so the round-1 jest/build results still apply.
- The worktree is clean (`git status --short` is empty). All mutations were confined to the scratchpad.

UI / design: not applicable. There are no view changes, only service functions and types.

### Verdict: CONFIRM

### Non-blocking notes
- The round-1 non-blocking notes still stand as optional polish: refresh-vs-append final-state assertion, 404 body-equality assertion, id/seq comparison on the rejected-replace re-read, and task 4.2 checkbox wording.
- The commit message says CR2 was probed by removing `FOR UPDATE`. That is a different mutation from the one I named. I have independently confirmed that it catches the named one (pre-lock read).
- Other `Instant.now()` sites in DataSourceService (e.g. :142 create) still carry nanoseconds. None of them feeds a per-row token in a response today. If HEL-1078/1080 ever expose row `updatedAt` from create, apply the same truncation (or truncate centrally in the repo).
