## Context

`DashboardApplyProposalSpec.scala` (~740 lines) is a single `AnyWordSpec` route-level
suite for `POST /api/dashboards/apply-proposal` (plus a couple of direct
`POST /api/panels` V41 checks). Lines 1–172 are shared scaffolding: an embedded
Postgres + Flyway migration, a real-RLS setup (`helio_app_test` NOSUPERUSER +
`helio_privileged` pools, mirroring `ApiTokenAuthSpec`), seeded users / data-source /
three DataTypes (pipeline-output, source-companion, other-user), `afterAll` teardown,
and private request helpers (`await`, `sessionCookie`, `csrfHeader`, `json`,
`dashboardCount`, `apply`). Line 174 onward is one `"POST /api/dashboards/apply-proposal"
should { ... }` block with ~31 `in { }` cases.

## Goals / Non-Goals

**Goals:**
- Each resulting spec file (and the shared base trait) comfortably under the ~250-line
  soft budget mechanically enforced by `npm run check:scala-quality`
  (`scripts/check-scala-quality.mjs`, which scans `backend/src/test/scala`). ~400 lines
  is CONTRIBUTING.md's "must propose a split" trigger, not the post-split target.
- Zero behavioral change: every test case moves verbatim; identical total `sbt test`
  count before and after.
- File names make each file's scope obvious.

**Non-Goals:**
- No production code, schema, migration, or API-contract changes.
- No new assertions, renamed test strings, or "while we're here" cleanups of test
  bodies.

## Decisions

**Decision: extract shared fixture into a base trait, then split cases into sibling
specs.** The ~172-line setup is heavy and identical for every case, so duplicating it
per file would be wasteful and fragile. Introduce an abstract base trait (e.g.
`ApplyProposalSpecBase`) in the same package (`com.helio.api`) that holds
`beforeAll`/`afterAll`, the seeded-id vars, and the request helpers as `protected`
members, extending `AnyWordSpec with Matchers with ScalatestRouteTest with
JsonProtocols with BeforeAndAfterAll`. Each concrete spec extends it and contributes
one `should` block. Note: Scala `import` statements are file-scoped and are NOT
inherited through the trait — each sibling spec file still declares its own top-of-file
imports for the symbols its moved test bodies reference (e.g. `StatusCodes`,
`JsObject`/`JsBoolean`, `UUID`, spray-json). That per-file import boilerplate is
expected and ordinary; the base trait only removes duplication of the setup/teardown,
seeded state, and helper methods.
- Alternative considered: duplicate setup per file — rejected (172× duplication,
  drifts over time).
- Alternative considered: a shared `BeforeAndAfterAll` singleton with a shared DB —
  rejected; ScalatestRouteTest fixtures are per-suite and the current per-suite
  embedded Postgres is the established pattern. Each concrete spec keeps its own
  embedded Postgres instance via the inherited `beforeAll` — same isolation as today,
  just a modest increase in total suite setup time (acceptable for a test-only refac).

**Decision: split by feature seam into ~3–4 files.** Suggested grouping (executor may
refine while keeping cohesion + under-400):
- Core apply + shape/appearance (happy path, layout, HEL-292 aggregation, HEL-293
  markdown/image/divider/chart/metric, invalid-type/blank-name/auth rejections).
- V41 companion-binding + unknown/cross-user rejections (proposal path, both
  directions).
- HEL-316 v1.5 `config` passthrough parity (collection baseType/layout, chart
  chartOptions, table density/columnOrder, text/markdown config.dataTypeId binding,
  flat-authoritative override).
- HEL-321 timeline sort (flat sort default, config.timelineOptions.sort derivation,
  invalid-sort rejection, explicit-config override).

**Decision: preserve the exact test-case strings.** Test descriptions (including their
`(HEL-###)` suffixes) move unchanged so failure output and traceability are stable.

## Risks / Trade-offs

- [Test double-count / silent drop] → Capture `sbt test` total before the split; after
  the split, confirm the total is identical. Executor records both counts in
  files-modified.md.
- [Base-trait member visibility] → Private helpers become `protected`; no external
  visibility change since all users are in-package subclasses.
- [Increased setup cost] → Each concrete suite spins its own embedded Postgres (as the
  monolith did for one suite). More suites = more startups; acceptable for a hygiene
  refactor and matches the existing per-suite pattern.

## Planner Notes

- Self-approved: no ESCALATION triggers — no new deps, no architectural change, no
  breaking API change, scope is exactly the ticket (test-file split).
- No `specs/` deltas: proposal declares no capability changes (behavior-preserving).
