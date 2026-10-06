# HEL-1291: Split PublicDashboardRoutes.scala (506 lines) by concern

## Description

origin_kind: followup
origin_ticket: HEL-1273

HEL-1273 added the public history-summary route, which brought `PublicDashboardRoutes.scala` to about 506 lines
(500 at b2a0d8088 after HEL-1337 made `outputRepo` a plain parameter).

## Acceptance Criteria

- Split the file into concern-focused route modules, for example panels/rows and history, composed by the existing
  entry point.
- Preserve behaviour: the same route tree (shown by a mechanical before/after comparison of the route directive
  structure / path+method enumeration), and the same test count before and after, with no assertion changes.
- The public/optional-auth and summary-only (D8: public dashboards never receive payloads) guarantees stay covered by
  the existing specs.
- Refactor discipline: any bug found is noted as a spinoff, not fixed here.

## Driver constraints (binding for this run)

- `nice -n 19 sbt testFull`, Bash timeout 600000, at most 2 test workers (leave `HEL924_TEST_GROUP_CONCURRENCY` unset
  or set it to at most 2). `sbt --client shutdown` and `cleanup.sh --phase4` as separate Bash calls.
- New route specs (none expected) extend `com.helio.testkit.HelioRouteTest`. EmbeddedPostgres only.
- Never create/update/delete anything under `~` outside the repo and its worktrees. Never pick deletion targets
  (including processes) by pattern, name or time window; never use `pkill`, `pgrep` or `killall`.
- Do not touch `.github/workflows/ci.yml`, `playwright.config.ts` or `.gitignore`. At most one CI run at a time.
- Scratch logs go in `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad`
  with a `hel1291-` prefix; keep full gate logs for any failing run.
