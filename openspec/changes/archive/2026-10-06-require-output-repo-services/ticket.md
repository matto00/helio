# HEL-1295: Make outputRepo a required parameter across services (no silent null defaults)

## Description

origin_kind: followup
origin_ticket: HEL-1256

HEL-1256 made `outputRepo` a required parameter on patch-set undo. When undo needs the repository and it isn't wired,
undo now returns a typed rejection. The HEL-1256 lane reports that these services still default `outputRepo = null`
(verify against main):

* PanelService, PipelineService, DashboardService, DashboardProposalService, DashboardContentsService,
  PipelineRunService, ProposalPanelSupport.

The sharpest one is around `PanelService.scala:635`: with no repository, the panel's `outputId` check is **silently
skipped**. Undo reaches that path when it recreates panels.

## Acceptance Criteria

* Each listed service takes the repository as a required parameter with no default, so leaving it out fails to
  compile. Where an optional repository is genuinely needed, a missing one returns a typed error and never silently
  skips a check.
* Every call site, test fixtures included, passes a real repository. Do not paper over it with a null.
* A test that would have caught the PanelService skip: a panel with an unowned or nonexistent `outputId` is rejected.
* Production wiring is unchanged: show that Main and ApiRoutes already pass the repository.

## Driver constraints (this run)

* Behaviour-preserving. A non-trivial bug found along the way is raised as a spinoff, not folded in.
* Do not touch `.github/workflows/ci.yml`, `.gitignore`, `frontend/playwright.config.ts` (other lanes own them), nor
  the frontend history files (L7 / HEL-1277 parked there).
* Backend tests: `nice -n 19 sbt testFull` with Bash timeout 600000 and at most 2 concurrent forked test groups
  (`HEL924_TEST_GROUP_CONCURRENCY` <= 2). `sbt --client shutdown` is its own separate Bash call.
* New route specs extend `com.helio.testkit.HelioRouteTest`. Prefer EmbeddedPostgres specs; record the exact id of
  anything created on the shared dev DB; never pick deletion targets by pattern/name/time window.
* Never write anything under `~` outside the repo and its worktrees (npm logs/caches included).
* Report any FirstRunRoutesSpec timeout or "Java heap space".
