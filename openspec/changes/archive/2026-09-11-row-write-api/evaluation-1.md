## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS (with one gap noted below, carried into Phase 2)
Issues:
- All ticket ACs (append preserves rows, replace is atomic, unauthorized-caller 404 shape parity)
  are addressed. tasks.md 1.1–5.11 all marked done; implementation matches, except task 5.7
  (see Phase 2 — a required sub-case of 5.7 was not actually implemented despite being checked off).
- No scope creep: diff is limited to the row-write API surface (repository/service/routes/protocol,
  schemas, OpenAPI, frontend service types, tests).
- No regressions: `applyStaticRefresh`'s call site updated correctly for the `replaceRows` rename;
  existing `replaceDatasetRows` tests updated in place, not deleted.
- Schemas/OpenAPI/frontend types updated in the same change (`schemas/sources/row-write-*.schema.json`,
  `frontend/src/features/sources/{types,services}/...`); `check-schema-drift.mjs` passes.
- Planning artifacts (design.md, spec deltas) reflect the final implemented behavior — cross-checked
  `dataset-row-write-api/spec.md` and `data-source-acl/spec.md` scenario-by-scenario against the diff;
  all scenarios are implemented and covered by tests except the joint-limit concurrency scenario below.

### Phase 2: Code Review — FAIL
Gates (all re-run fresh in `WORKTREE_PATH`, not trusted from the executor's report):
- `sbt test`: 4135 tests, 0 failed — PASS.
- `npm run lint`: 0 warnings — PASS.
- `npm run format:check`: PASS.
- `npm test` (root jest + frontend jest): 25+301 suites, 3198+248 tests, all passed — PASS.
- `npm --prefix frontend run build`: succeeded — PASS.
- `node scripts/check-schema-drift.mjs`: in sync — PASS.
- `node scripts/check-openspec-hygiene.mjs`: clean — PASS.

Code quality: 0-based seq convention matches `insertDatasetSource`/V106 (verified — `appendRows`
continues from `maxExistingSeq + 1`, `replaceRows` re-indexes `0..N-1`); `lockSource` + fresh
in-transaction reads correctly close the schema/count race window design.md flagged; atomicity for
replace was verified with an actual re-read after a rejected request (`after shouldBe before`,
byte-for-byte, in `DataSourceRepositorySpec`); the two real `Future.zip` concurrency tests
(concurrent-append, refresh-vs-append, PUT-vs-refresh-schema-change) are genuine parallel-Future
tests, not sequential calls dressed up as concurrent; the RLS test in `RlsOwnerTablesSpec` genuinely
exercises the non-superuser `helio_app_test` role via `ctx.withUserContext`/`appDb`, and additionally
proves cross-owner isolation (not just a policy-existence check). Response shape, empty-array
semantics (POST `[]` → 400, PUT `[]` → clears), and non-dataset-kind rejection are all correct and
tested. ACL 404 shape parity with DELETE is tested and matches.

**Blocking issue — task 5.7 / spec.md scenario not actually implemented:**
tasks.md 5.7 requires: "include a concurrent-appends-jointly-exceeding-the-limit case (each
individually under the limit, combined over it) to prove the check runs inside the lock, not before
it." `dataset-row-write-api/spec.md`'s own "Two concurrent appends cannot jointly exceed the row
limit" scenario states the same requirement. This is exactly the race the whole `lockSource`
design exists to close for the row-count check specifically (as opposed to the seq/schema races,
which ARE covered by real concurrent tests).

I grepped the full test diff (`DataSourceRepositorySpec.scala`, `DataSourceRoutesSpec.scala`) for
this case and it is absent — every `limit`-related test present (`appendRows rejects when the
resulting total would exceed maxRows`, `replaceRows rejects a replacement exceeding maxRows`, the
route-level 500/501-row limit tests) is a *single-caller* test, not a concurrent one. The three
concurrency tests that do exist (`two concurrent appendRows...seq`, `replaceRows(Some) racing
appendRows`, `replaceRows(None) racing replaceRows(Some)`) all use small row counts and never
approach `maxRows`, so none of them incidentally cover the joint-limit case either. tasks.md 5.7 is
checked off `[x]` but the sub-case it explicitly calls out was not written — this is a checked-but-
not-done task item (Phase 1's "no task item marked done that doesn't match what was implemented").

Given this ticket's explicit owner priority ("correctness over speed... hold the bar high... on
concurrent-append tests actually being real concurrent tests") and that the row-count-under-lock
guarantee is exactly the kind of race a sequential test cannot prove, this is a Change Request, not
a suggestion.

### Phase 3: UI Review — N/A
No `frontend/**` UI-affecting files (only typed service/type additions, no UI consumer — HEL-1080 is
downstream per the ticket), no `ApiRoutes.scala` routing changes beyond the data-source-scoped
addition already covered by backend route tests, no `openspec/specs/**` (only `openspec/changes/**`)
touched in a way that changes rendered UI. Confirmed no UI component files appear in `git diff --name-only`.

### Overall: FAIL

### Change Requests
1. Add the concurrent-appends-jointly-exceeding-the-limit test required by tasks.md 5.7 and
   `dataset-row-write-api/spec.md`'s matching scenario, in
   `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositorySpec.scala`
   (alongside the existing `two concurrent appendRows calls...` test near line 462). Set up a source
   with `existingCount` rows such that two concurrent `appendRows` calls each individually stay
   under `maxRows` but their combined total exceeds it (e.g. `maxRows = 2`, 1 existing row, two
   concurrent single-row appends), issue both via `Future.zip` (matching the existing pattern), and
   assert: exactly one of the two `Either` results is `Left(...)` (or both succeed only if their
   combined total is still `<= maxRows`, which the chosen numbers should rule out), and the source's
   final row count never exceeds `maxRows`. This is the only test that actually proves the row-count
   check is evaluated inside the lock rather than racily before it — the two callers here need a
   fixture where a pre-lock check would wrongly let both through.

### Non-blocking Suggestions
- None beyond the above; code quality, atomicity, RLS coverage, and every other reviewed area are
  solid.
