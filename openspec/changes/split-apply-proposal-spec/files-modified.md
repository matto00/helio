# Files modified — HEL-320 split DashboardApplyProposalSpec

Behavior-preserving structural split of a ~741-line route-level ScalaTest suite into
a shared base fixture + four cohesive sibling specs. No production, schema, migration,
or API-contract files touched.

## Files created / modified

- `backend/src/test/scala/com/helio/api/ApplyProposalSpecBase.scala` (created, 178 lines)
  — shared fixture extracted from the monolith: embedded-Postgres + Flyway migration,
  real-RLS `helio_app_test`/`helio_privileged` pools, seeded users/data-source/three
  DataTypes, `beforeAll`/`afterAll`, and request helpers (`await`, `sessionCookie`,
  `csrfHeader`, `json`, `dashboardCount`, `apply`). `abstract class` (not a bare
  `trait`) because it extends the `AnyWordSpec` class, which a trait cannot extend;
  private helpers made `protected` for subclass access.
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala` (rewritten, 233 lines)
  — core apply happy-path + shape/appearance (12 cases): valid proposal + layout,
  HEL-292 aggregation (2), HEL-293 markdown/image/divider + chart appearance + metric
  literal (3), invalid chartType/orientation/type/no-dataTypeId + blank-name + auth (6).
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalBindingSpec.scala` (created, 149 lines)
  — DataType-binding rejections/acceptance (8 cases): V41 companion + unknown +
  cross-user (flat path, 3); HEL-316 text/markdown `config.dataTypeId` companion
  rejections (2), valid bindings (2), unknown rejection (1).
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalConfigSpec.scala` (created, 141 lines)
  — HEL-316 v1.5 `config` passthrough parity (5 cases): collection baseType/layout,
  chart chartOptions, table density/columnOrder, flat-authoritative override, no-config
  regression.
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalTimelineSpec.scala` (created, 109 lines)
  — HEL-321 timeline flat-binding (4 cases): flat-only sort default, flat sort
  derivation, invalid-sort rejection, explicit-config override.

All test-case description strings and bodies moved verbatim (including their
`(HEL-###)` suffixes). Total moved cases: 12 + 8 + 5 + 4 = 29.

## Verification evidence

Baseline (on branch, before split), `sbt "testOnly ...DashboardApplyProposalSpec"`:

```
[info] Total number of tests run: 29
[info] Tests: succeeded 29, failed 0, canceled 0, ignored 0, pending 0
```

Post-split, all four sibling suites together:

```
[info] Run completed in 5 seconds, 279 milliseconds.
[info] Total number of tests run: 29
[info] Suites: completed 4, aborted 0
[info] Tests: succeeded 29, failed 0, canceled 0, ignored 0, pending 0
```

Full backend suite (`sbt test`):

```
[info] Total number of tests run: 1470
[info] Suites: completed 77, aborted 0
[info] Tests: succeeded 1470, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

`npm run check:scala-quality`: `Scala code-quality check: clean (45 soft warning(s))`
— zero hard errors; none of the five new/rewritten files appear in the soft-warning
list (each is under the ~250-line budget). The pre-split 741-line
`DashboardApplyProposalSpec.scala` warning is gone; no new warnings introduced.

## Resulting line counts

| File | Lines |
| --- | --- |
| ApplyProposalSpecBase.scala | 178 |
| DashboardApplyProposalSpec.scala | 233 |
| DashboardApplyProposalBindingSpec.scala | 149 |
| DashboardApplyProposalConfigSpec.scala | 141 |
| DashboardApplyProposalTimelineSpec.scala | 109 |
