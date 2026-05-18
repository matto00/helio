# Evaluation Report — HEL-265 CS1 (Pipeline `owner_id` foundation)

**Cycle**: 2 (sub-PR 1 of 5)
**Evaluator**: linear-evaluator (opus)
**Worktree**: `/home/matt/Development/helio/.worktrees/HEL-265`
**Branch**: `feature/repo-acl-enforcement/HEL-265`
**Commits reviewed**: `fefae33`, `23af14d`, `8db821a` (cycle 2 implementation; cycle 1 `e56cccf` was investigation only)

## Verdict

**PASS** — ready to open PR.

CS1 lands the pipeline `owner_id` data-model foundation cleanly. The diff is
exactly the additive footprint the design committed to: one Flyway migration,
one new Slick column, one appended domain field, one new repository method
(`findByIdInternal`) which is today a delegating alias for `findById`, and one
registry entry. No service or route file was touched. The only test-fixture
ripple (`SparkJobSubmitterSpec.makePipeline`) is a single literal line.

The 605 baseline backend tests pass alongside 5 new owner_id tests for a
clean 610/610. No file crossed the 400 line hard cap.

## Static gates

| Gate                          | Result                                |
|-------------------------------|---------------------------------------|
| `sbt test` (backend)          | 610/610 pass (39 suites, ~30s)        |
| `npm run lint`                | clean (max-warnings 0)                |
| `npm run format:check`        | clean                                 |
| `npm test` (frontend Jest)    | 674/674 pass (59 suites, ~6s)         |
| `npm run build` (frontend)    | clean (built in ~4s)                  |
| `npm run check:schemas`       | clean (6 protocols checked)           |
| `npm run check:openspec`      | clean                                 |
| `npm run check:scala-quality` | clean (18 pre-existing soft warnings; 0 new) |

All gates green. The `check:scala-quality` 18 soft warnings are unchanged
from main; this PR added one line to `model.scala` (268 → 269) which was
already over the soft cap pre-CS1.

## File-size sweep

| File                                                            | Pre | Post | Status                            |
|-----------------------------------------------------------------|-----|------|-----------------------------------|
| `db/migration/V32__pipelines_owner.sql`                         | — (new) | 23 | Under cap; well-commented        |
| `infrastructure/PipelineRepository.scala`                       | 213 | 228 | Under 250 soft cap               |
| `domain/model.scala`                                            | 268 | 269 | Pre-existing soft warning + 1L   |
| `api/ApiRoutes.scala`                                           | 168 | 170 | Under cap (+1L registry, +1L import) |
| `test/.../PipelineRepositorySpec.scala`                         | 132 | 211 | Under cap; +5 cohesive test cases |
| `test/.../SparkJobSubmitterSpec.scala`                          | 336 | 337 | Pre-existing soft warning + 1L fixture |

Nothing approached the 400 line hard cap.

## Diff sanity-check (per modified file)

### `V32__pipelines_owner.sql` — PASS

Spec called for: `ALTER TABLE pipelines ADD COLUMN owner_id UUID NOT NULL
DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES users(id)` +
`CREATE INDEX idx_pipelines_owner_id ON pipelines(owner_id)` + comment block
documenting backfill + deployment caveat.

Migration contents verified: column definition exact match; index name exact
match; comment block (lines 1-19) explicitly covers (a) what is being added,
(b) the system-user backfill rationale tied to the V10 precedent, (c) the
production deployment caveat for pre-existing per-user pipelines, and (d) the
deliberate omission of `owner_id` from `pipeline_steps` / `pipeline_runs`
(JOIN approach in CS2 per design.md Q1). The migration ran cleanly against
the embedded Postgres test fixture during `sbt test` (Flyway reports
"Successfully applied 32 migrations").

### `PipelineRepository.scala` — PASS

- `PipelineRow` gains `ownerId: UUID` (NOT `Option[UUID]` — matches
  Dashboard precedent because V32 declares the column NOT NULL from the
  start; correct choice per executor's nuance #3).
- `PipelineTable` adds `column[UUID]("owner_id")` and includes it in the
  `*` projection in the same field order as the row.
- `findById` is now a one-line delegator to `findByIdInternal`. The
  semantics are identical — same SQL, same mapping. CS2 will diverge.
- `findByIdInternal` is the renamed body; ScalaDoc documents its
  bypass-ACL nature and the CS1/CS2 evolution plan.
- The inline lambda that previously built `Pipeline` was extracted into a
  `private def rowToPipeline(row: PipelineRow)` helper. This is a strict
  win for DRY (the new helper will be reused by CS2's owner-scoped reads)
  and is the minimum additional change needed to add the `ownerId` field
  to the mapping. Not scope creep.
- `create()` now persists `ownerId = UUID.fromString(ownerId.value)` — the
  `ownerId: UserId` parameter was already in the signature (CS2b parity);
  the value previously flowed only into the new DataType row, not the
  pipelines row. Per executor's nuance #4, this is the minimum behavior
  change required for the new column to populate on inserts. Pre-V32 inserts
  could not have carried an owner because no column existed.

### `model.scala` — PASS

Single-line addition: `ownerId: UserId` appended (not inserted) to
`Pipeline`'s case-class signature. Appending preserves the trailing-comma
diff hygiene and minimizes positional construction sites — only
`SparkJobSubmitterSpec.makePipeline` (which uses named parameters anyway)
needed touch. No other case class touched.

### `ApiRoutes.scala` — PASS

- Existing import line extended to add `PipelineId` to the alphabetical
  domain import group. Correct location.
- One new line in the `ResourceTypeRegistry` constructor:
  `ResourceType("pipeline", id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))`.
  Exact match to design.md Q1 row for Pipeline. The previous line gained a
  trailing comma — the only "deletion" line in the diff for this file.

### `PipelineRepositorySpec.scala` — PASS

Five new cases in a clearly demarcated `"PipelineRepository owner_id (V32)"`
section with a section comment explaining "ACL enforcement lands in CS2":

1. `"default newly-inserted rows missing owner_id to the system user"` —
   exercises the V32 DEFAULT path via the existing `seedPipeline()` helper.
2. `"persist an explicit owner_id when create() is called with a non-system
   user"` — seeds a fresh user + data source, calls `pipelineRepo.create`
   with that user's id, asserts round-trip via `findByIdInternal`.
3. `"findByIdInternal returns the row regardless of owner"` — confirms
   the bypass semantic (today identical to `findById`).
4. `"registry resolver returns the pipeline's owner id"` — constructs a
   `ResourceType` + a `ResourceTypeRegistry` and exercises the lookup
   path the `AclDirective` will use in CS2.
5. `"registry resolver returns None for an unknown pipeline id"` — the
   negative case.

Each test is one logical assertion path; no hidden coupling between cases.
The use of raw SQL (`sqlu"INSERT INTO users (...)"`) to seed the prerequisite
foreign-key rows is appropriate — the existing `seedPipeline` helper at the
top of the file does the same.

### `SparkJobSubmitterSpec.scala` — PASS

A single line addition inside `makePipeline`:
`ownerId = UserId("00000000-0000-0000-0000-000000000001")`. The executor's
nuance #2 calls out that promoting the existing string literal to a shared
constant would be drive-by refactoring outside CS1's scope — the literal
here is the right call.

## Scope discipline check

Verified via `git diff --name-only main..HEAD` — the only modified Scala
files are:
- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala`
- `backend/src/main/scala/com/helio/domain/model.scala`
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala`
- `backend/src/test/scala/com/helio/infrastructure/PipelineRepositorySpec.scala`
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala`

Plus the new SQL file and OpenSpec docs. **No service file, no Pipeline*Routes
file, no DataType/DataSource/Dashboard/Panel repo, no PipelineStepRepository,
no PipelineRunRepository was touched.** This matches the CS1 scope exactly.

Deletion-line audit (`git diff main..HEAD | grep -E '^-[^-]'`) shows only:
- Import expansion (single line replaced by single line — adds `PipelineId`)
- Inline `Pipeline(...)` builder lambda replaced by extracted `rowToPipeline`
  helper call
- Field-list trailing line updates to accommodate the new column / field
- Trailing-comma additions before the new registry entry / fixture line
- Single-import line restructure in the test file (adds `DataSourceId`,
  `UserId`; pulls in `ResourceType`, `ResourceTypeRegistry`)

Every deletion is in the service of a single additive change. No
out-of-scope behavior modification snuck in.

## Migration sanity-check

Verified by sbt test passing (which runs Flyway end-to-end against
EmbeddedPostgres). Spot-check of `V32__pipelines_owner.sql`:

- Column type, nullability, default, REFERENCES all correct
- System user `00000000-0000-0000-0000-000000000001` is the canonical
  default seeded by V10 (confirmed by audit referenced in
  executor-report-1)
- Index name follows the V17 `idx_<table>_<column>` convention
- No `RAISE NOTICE` or other unintended side-effects
- The deployment caveat is in a code comment (not a `RAISE NOTICE`) which
  is the right place — Flyway log noise is reserved for actual runtime
  warnings

The "default newly-inserted rows missing owner_id to the system user" test
implicitly validates the DEFAULT clause; the "persist an explicit owner_id"
test validates the explicit-insert path. The lack of a test for the FK
constraint is fine — Flyway itself will fail loudly if the constraint is
malformed, and `sbt test` would have caught that.

## Behavior-preservation evidence

- 605 baseline backend tests pass without modification. The only test
  file changes are (a) +5 new owner_id assertions in
  `PipelineRepositorySpec`, (b) a one-line fixture update in
  `SparkJobSubmitterSpec`. No existing test was rewritten.
- `findById` retains its original `PipelineId => Future[Option[Pipeline]]`
  signature. All callers (`PipelineService`, `PipelineRunService`,
  `PipelineStepRoutes`, `PipelineRunStatusRoutes`, etc.) compile and run
  unchanged.
- `create()` already accepted `ownerId: UserId` from CS2b — the only
  behavior change is that the value now persists into a real column on
  the `pipelines` row instead of being discarded. This is the minimum
  delta required to make the new column meaningful and is what CS2 will
  read in ACL queries.
- `npm test` (frontend) unchanged at 674/674; no frontend files touched.

## Acceptance-criteria sweep (CS1 / Cycle 2 only)

| # | Criterion                                                       | Status |
|---|-----------------------------------------------------------------|--------|
| 1 | V32 with column + default + REFERENCES + index + caveat comment | ✓      |
| 2 | `PipelineRow` + `PipelineTable` extended                        | ✓      |
| 3 | Domain `Pipeline` extended with `ownerId: UserId`               | ✓      |
| 4 | `findByIdInternal` added                                        | ✓      |
| 5 | `ResourceTypeRegistry` registers "pipeline"                     | ✓      |
| 6 | `PipelineRepository.create()` persists `ownerId`                | ✓      |
| 7 | 5 new test cases covering the spec'd assertions                 | ✓      |

All Cycle 2 tasks.md checkboxes correctly marked `[x]`. Cycles 3-6
checkboxes remain `[ ]` as expected.

## Non-blocking observations (CS2 watch-outs)

1. **`SparkJobSubmitterSpec.makePipeline` uses a system-user literal.**
   Once CS2 starts adding per-test owners for ACL assertions, that helper
   should grow an `ownerId` parameter rather than spreading literals. Flag
   for CS2's test refactor.

2. **`UserId(row.ownerId.toString)` round-trips a UUID through a string.**
   This is consistent with `Dashboard`/`Panel` rows in the codebase
   (`UserId` is value-class over `String`), so it's the right call for
   CS1. If CS5's cleanup pass introduces a `UserId.fromUUID(uuid: UUID)`
   smart constructor, propagate the change here as well. No action this
   PR.

3. **The `findByIdInternal` rename pattern will need to ripple to other
   repos in CS3/CS4.** This PR establishes the precedent — `findByIdInternal`
   is the unscoped variant, `findById` (post-CS2) is the ACL-aware one.
   Document this convention in CS5's cleanup notes if not already present.

4. **The registry entry now has 5 resources.** No structural issue yet,
   but if CS5 adds `pipeline_step` or similar, the constructor positional
   list will get unwieldy. Future ergonomic improvement: builder-style
   API. Out of scope.

5. **`PipelineRunRepository` and `PipelineStepRepository` remain unchanged**
   intentionally (per design.md Q1 — those will JOIN on `pipelines.owner_id`
   in CS2 rather than carry their own column). Confirmed unmodified in
   this PR.

6. **Production deployment ordering** is correctly called out in the V32
   comment block. The orchestrator may want to mirror this in the eventual
   release notes for the CS1→CS2 cutover.

## Recommendation to orchestrator-relay

**Ready to open PR.** CS1 is a clean, focused, additive change. The
five-sub-PR plan is holding shape; CS2 can build on this foundation without
any rework needed in CS1's artifacts. No cycle 3 needed.
