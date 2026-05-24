# Backend domain-ADT foundations — Change Set 2c-1 of HEL-236

## Why

The original CS2c brief bundled three sealed-trait ADT remodels (Panel, DataSource, PipelineStep) + wire-shape evolution + frontend lockstep + engine split + run-lifecycle decomp + schemas + Playwright smoke into a single PR. After exploration, the executor surfaced that the full scope (~50 backend + ~25 frontend files + 4+ schemas + the first-ever intentional wire-contract break in HEL-236) carries too much concentrated risk for one delivery — half-shipped wire shape, evaluator pushback on rigor, reviewer cognitive load.

CS2c is being split into three:

- **CS2c-1 (this PR)** — foundations, no wire shape change
- **CS2c-2** — DataSource ADT + frontend lockstep + schema + repo alignment + inner-vs-left-join codified
- **CS2c-3** — PipelineStep ADT + engine split + run-lifecycle decomp + Panel ADT + frontend lockstep + schemas + snapshot + Playwright

This PR delivers the type-safety prerequisites the ADT remodels assume: a real `PipelineRunId` value class, ID-segment matchers for `PipelineStepId` and `PipelineRunId`, and pipeline repository signatures that accept value-class IDs end-to-end. With those landed on main first, CS2c-2 and CS2c-3 can focus on the ADT shape + wire contract evolution without mixing in type-safety housekeeping.

## What changes

### `PipelineRunId` value class

`PipelineId` and `PipelineStepId` already exist as `AnyVal` wrappers in `domain/model.scala`. `PipelineRunId` was missing — runs were threaded as raw `String` through the codebase. CS2c-1 closes the gap.

### `IdParsing.scala` segments

`PipelineStepIdSegment` and `PipelineRunIdSegment` join the existing `DashboardIdSegment` / `PanelIdSegment` / `DataTypeIdSegment` / `DataSourceIdSegment` / `UserIdSegment` family. Routes can now match on typed IDs everywhere instead of bare `Segment` strings.

### Repository signature narrowing

`PipelineRepository`, `PipelineStepRepository`, and `PipelineRunRepository` previously accepted raw `String` for ID parameters. All three now take value-class IDs (`PipelineId`, `PipelineStepId`, `PipelineRunId`, plus `DataSourceId` on the cross-repo lookup). Call sites in services, routes, the Spark submitter, and tests are updated to thread the typed IDs.

### Things that DO NOT change in CS2c-1

- **Wire shape** — byte-identical to pre-CS2c-1
- **JSON formatters** — untouched
- **`Panel`, `DataSource`, `PipelineStep` case classes** — flat shapes still; ADT remodel is CS2c-2/CS2c-3
- **`InProcessPipelineEngine`** — untouched (split is CS2c-3)
- **`PipelineRunRoutes.scala`** — untouched (decomp is CS2c-3)
- **`AuthService.scala`** — byte-identical
- **DB shape** — no Flyway migration
- **Frontend** — no changes

## Impact

- **Specs affected**: none — wire shapes byte-identical
- **Added**: `PipelineRunId` value class + 2 ID segments
- **Modified**: 3 repos, 1 service (`PipelineService`), 2 routes (`PipelineRunRoutes`, `PipelineStepRoutes`), 1 protocol (`IdParsing`), 1 Spark submitter (`SparkJobSubmitter`), 1 domain (`model.scala`), 5 test files
- **Total files modified**: 14
- **Deleted**: none
- **Tests**: 511 backend tests pass unchanged; 664 frontend tests untouched
- **Frontend**: untouched

## Out of scope

- **All three domain ADTs** — CS2c-2 (DataSource) and CS2c-3 (Step + Panel)
- **Wire shape evolution** — CS2c-2 starts evolving with DataSource discriminated union
- **Engine split + run-lifecycle service + `PipelineRunRoutes` decomp** — CS2c-3
- **Schema / OpenSpec updates** — CS2c-2 and CS2c-3
- **Inner-vs-left-join policy codification** — CS2c-2
- **Playwright smoke** — CS2c-3 (no functional surface changes here)
- **HEL-242** — naturally addressed by Panel ADT in CS2c-3; verify post-hoc
- **HEL-256** — parallel side-PR off main
- **HEL-265** — backlogged

## Acceptance criteria

- [x] `PipelineRunId` value class added to `domain/model.scala`
- [x] `PipelineStepIdSegment` and `PipelineRunIdSegment` added to `IdParsing.scala`
- [x] `PipelineRepository`, `PipelineStepRepository`, `PipelineRunRepository` signatures accept value-class IDs throughout
- [x] All call sites updated (services, routes, Spark submitter, 5 test files)
- [x] `sbt test` — 511 passing, 0 failures (matches baseline)
- [x] `npm test` — 664 passing (frontend unchanged so all baseline)
- [x] `npm run lint` — zero warnings
- [x] `npm run format:check` — clean
- [x] `npm run check:schemas` — passes (no schema changes, still verified)
- [x] `npm run check:openspec` — clean
- [x] `npm run check:scala-quality` — passes (no new inline FQNs; pre-existing soft warnings unchanged)
- [x] AuthService.scala byte-identical to main (verified via `git diff`)
- [x] No wire shape change

## Risk

- **Low.** Internal-only typing change. No wire shape, no business logic, no auth touched. The blast radius is 14 files of mechanical narrowing.
- **Latent issue surfaced (not addressed here)**: `PipelineService.AllowedOps` is missing `"aggregate"` even though the engine + analyze service support it. Tracking as a spinoff for CS2c-2 or HEL-141.
