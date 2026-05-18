# Executor Report — HEL-265 Cycle 2 (PR/CS1: Pipeline `owner_id` foundation)

## Summary

CS1 is pure-additive groundwork: it teaches the data model and the registry
that pipelines have owners, without changing the behavior any existing
caller observes. Every previous-cycle call path (`pipelineRepo.findById`,
`PipelineService.listSummaries`, `PipelineRunService.submit`, …) compiles
and runs identically to pre-CS1. The only new public method is
`PipelineRepository.findByIdInternal(id)`, which today is a clearer-named
alias for `findById`; CS2 will diverge the two signatures (`findById` will
gain a `user` parameter and ACL-enforce, while `findByIdInternal` keeps the
unscoped semantics for documented privileged callsites).

## Scope completed

Tasks listed under `tasks.md` § Cycle 2 (PR/CS1) — all 10 checked.

1. Flyway `V32__pipelines_owner.sql` — `owner_id UUID NOT NULL DEFAULT
   system-user REFERENCES users(id)` plus `idx_pipelines_owner_id`.
2. Comment block in V32 documents the production deployment caveat.
3. `PipelineRow` + `PipelineTable` gain `ownerId: UUID`.
4. `Pipeline` domain case class gains `ownerId: UserId` (appended).
5. `PipelineRepository.findByIdInternal(id)` added; `findById` now
   delegates to it.
6. `ResourceTypeRegistry` registers the `"pipeline"` key with the
   `findByIdInternal`-backed resolver.
7. `PipelineService.create` already threaded `user` through to
   `pipelineRepo.create` (HEL-236 CS2b parity); the additive change is the
   repo now actually persists it via the new `PipelineRow.ownerId`.
8. New test suite — five assertions covering default-backfill, explicit
   owner via `create()`, `findByIdInternal` returning regardless of owner,
   registry resolver round-trip, and registry resolver `None` for unknown
   id.

## Files modified

See `files-modified.md` for the consolidated cycle 1 + cycle 2 list and
per-file rationale.

### Production code

- `backend/src/main/resources/db/migration/V32__pipelines_owner.sql` (new, 25 lines)
- `backend/src/main/scala/com/helio/domain/model.scala` (Pipeline case class extended)
- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala` (213 → 229 lines)
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (registry + import)

### Test code

- `backend/src/test/scala/com/helio/infrastructure/PipelineRepositorySpec.scala`
  (132 → ~210 lines; +5 test cases)
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala`
  (`makePipeline` helper — one-line `ownerId` addition)

## Test counts

Backend: **610 tests pass** (up from 605 — 5 new owner_id tests). The 5
new tests live in `PipelineRepositorySpec`'s `PipelineRepository owner_id
(V32)` suite. All 39 suites green. No flake observed.

Frontend: 674 tests pass (unchanged; no frontend changes).

## File-size deltas (soft budget 250 lines)

| File                                                              | Before | After | Note                          |
|-------------------------------------------------------------------|--------|-------|-------------------------------|
| `infrastructure/PipelineRepository.scala`                         | 213    | 229   | Under budget; +1 method, +1 helper |
| `domain/model.scala`                                              | 268    | 269   | Already over (pre-existing soft warning); +1 line |
| `api/ApiRoutes.scala`                                             | 168    | 169   | Under budget                  |
| `test/.../PipelineRepositorySpec.scala`                           | 132    | ~210  | Under budget                  |

No file crossed the 400-line hard cap. The `model.scala` soft warning was
already there from prior changes.

## Gate results

| Gate                       | Result                       |
|----------------------------|------------------------------|
| `sbt test` (backend)       | 610/610 pass                 |
| `npm test` (frontend Jest) | 674/674 pass                 |
| `npm run build` (frontend) | clean                        |
| `npm run lint`             | clean (max-warnings 0)       |
| `npm run format:check`     | clean                        |
| `npm run check:schemas`    | clean (6/6 protocols)        |
| `npm run check:openspec`   | clean                        |
| `npm run check:scala-quality` | clean (18 pre-existing soft warnings; none introduced) |

## Nuance for evaluator

1. **`findById` keeps its original signature this cycle, by design.** The
   five-sub-PR plan in `design.md` Q3 / Q4 deliberately defers the user
   parameter to CS2 so this PR is reviewable as "data-model groundwork
   only." `findByIdInternal` exists today as a clearer-named alias; CS2
   will diverge them.
2. **`SparkJobSubmitterSpec.makePipeline` uses a string literal, not the
   sibling `ownerId` constant.** `ownerId` is defined as a `val` inside
   the `seedPipeline` helper — not in `makePipeline`'s scope. Promoting
   it to an enclosing scope is exactly the kind of "drive-by improvement"
   the refactor-discipline rule forbids during a structural pass. Use the
   literal here; refactor later if it shows up in CS5's cleanup pass.
3. **`PipelineRow.ownerId` is typed `UUID`, not `Option[UUID]`.**
   `DashboardRepository` uses `UUID` (post-V10 NOT NULL); the older
   `DataSourceRepository` and `DataTypeRepository` use `Option[UUID]`
   because their rows were originally nullable before V10 / V14 / V15.
   V32 declares `pipelines.owner_id` as NOT NULL from the start (default
   backfills), so `UUID` is the right Slick type. This matches Dashboard
   precedent.
4. **`PipelineRepository.create()` was already taking a `UserId` from
   `PipelineService.create()`.** What CS1 changes is that the repo now
   actually persists it (previously the value flowed into the new
   `DataType` row but not into the `pipelines` row — visible by the lack
   of an `owner_id` column on `pipelines` pre-V32). This is the smallest
   possible behavior change required to make the new column populate
   correctly on inserts. Pre-V32 inserts continue to work because no
   `pipelines` row could carry an owner before this PR shipped.
5. **No `pipeline_steps` / `pipeline_runs` schema changes.** Per
   design.md Q1, those tables intentionally do NOT receive their own
   `owner_id` column; CS2 will JOIN their reads against
   `pipelines.owner_id` so the canonical owner lives in one place.
6. **OpenSpec / files-modified docs updated in-place.** `files-modified.md`
   now spans both cycles; `tasks.md` checkboxes flipped only for the CS1
   section.

## Out-of-scope spinoff candidates noticed (not absorbed)

None new this cycle. The spinoffs surfaced in cycle 1
(`JoinStep.evaluate` rightDataSourceId cross-user access; future RLS
defense-in-depth) remain in `design.md` and are not affected by this PR.

## Blockers

None.
