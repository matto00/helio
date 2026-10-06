# HEL-1337: Remove dead outputRepo null-checks and always-Some Option(dbContext) derivations after HEL-1295

## Description

origin_kind: followup
origin_ticket: HEL-1295

HEL-1295 (0614c979) made `outputRepo` required in seven services, and made `dbContext` required in `ApiRoutes`.
Some leftovers remain. Verify each one against main:

* Several services already require `outputRepo` but still null-check it: OutputControlsValidator:56,
  WorkspaceContextService:132/308, WorkspaceSearchService:76, and PatchSetApplyResolvers:637/774.
* `PublicDashboardRoutes` still takes `outputRepoOpt: Option[OutputRepository] = None`.
* Each `Option(dbContext)` derivation in `ApiRoutes` is now always `Some`.
* Cosmetic: `PipelineService.createTransactional` is indented one level too deep.

## Acceptance Criteria

* Remove each dead branch, keeping behaviour the same.
* Any null check that a test still exercises must be justified, or its test updated.
* The test count must be the same before and after, apart from tests that asserted states which can no longer
  happen. List each one removed and say why.

## Driver constraints (binding for this run)

* Behaviour-preserving refactor (CONTRIBUTING refactor discipline). A real bug found along the way is filed as a
  spinoff note in the PR body, never folded in.
* If making `PublicDashboardRoutes`' repo required changes public-route behaviour, escalate.
* Do not touch `.github/workflows/ci.yml`, `playwright.config.ts`, or `.gitignore`.
* Backend tests: `nice -n 19 sbt testFull`, Bash timeout 600000, at most 2 workers. `sbt --client shutdown` as its
  own separate Bash call. Never `pkill`/`pgrep`/`killall`; never pick deletion/kill targets by pattern.
* New route specs extend `com.helio.testkit.HelioRouteTest`; tests use EmbeddedPostgres.
* Report any FirstRunRoutesSpec timeout or "Java heap space".
