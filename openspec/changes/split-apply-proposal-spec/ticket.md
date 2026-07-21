# HEL-320 — Split DashboardApplyProposalSpec.scala (past ~400-line soft threshold)

URL: https://linear.app/helioapp/issue/HEL-320
Priority: Low
Branch: task/split-apply-proposal-spec/HEL-320

## Context

Non-blocking cleanup flagged by the evaluator during HEL-316 (helio-mcp proposal
flow → v1.5 panel-config parity, PR #252). `backend/.../DashboardApplyProposalSpec.scala`
grew past CONTRIBUTING.md's ~400-line soft threshold. It was intentionally kept
cohesive in HEL-316 to colocate the V41 companion-binding regression tests with the
existing apply-proposal coverage, rather than splitting mid-ticket (refactor
discipline).

NOTE: the file grew further to ~740 lines after HEL-321 merged (added timeline-sort
proposal tests). This branch is cut from current main, so the file is ~740 lines.

## Task

Split `DashboardApplyProposalSpec.scala` into cohesive suites along natural seams,
e.g.:

* Core apply-proposal happy-path + shape coverage (flat fields, layout).
* v1.5 `config` passthrough parity (collection baseType/layout, chart chartOptions,
  table density/columnOrder, text/markdown binding).
* V41 companion-binding rejection regressions (proposal + direct `POST /api/panels`
  paths, both directions).

Keep behavior/coverage identical — this is a behavior-preserving test
reorganization only. No production code changes.

## Acceptance criteria

1. `DashboardApplyProposalSpec.scala` (and any new sibling specs) are each
   comfortably under the ~400-line soft threshold.
2. No test cases lost — total assertion coverage unchanged; `sbt test` green.
3. Suite names/structure read clearly (each file's scope obvious from its name).

## Notes

Pure follow-up hygiene; low priority. Deferred from HEL-316 per refactor discipline
(keep structural refactors out of feature/bug tickets).

### Orchestrator note on current file structure (from inspection)

- Lines 1–172: shared scaffolding — imports, class decl, `beforeAll` (embedded
  Postgres + Flyway + real-RLS `helio_app_test`/`helio_privileged` pools + seeded
  users/data-source/three DataTypes), `afterAll`, and private helpers
  (`await`, `sessionCookie`, `csrfHeader`, `json`, `dashboardCount`, `apply`).
- Line 174 onward: a single `"POST /api/dashboards/apply-proposal" should { ... }`
  block holding ~31 `in { }` test cases spanning core apply, HEL-292 aggregation,
  HEL-293 appearance, V41 rejection, HEL-316 config-parity, and HEL-321 timeline.
- The shared scaffolding is substantial (~172 lines), so the clean
  behavior-preserving split is to extract it into a shared base trait/fixture that
  each split spec extends, rather than duplicating setup across files. This keeps
  each resulting file well under 400 lines and moves test bodies verbatim.
- Preserve EXACT test-case strings and bodies (move, don't rewrite). Confirm the
  total `sbt test` count is identical before and after.
