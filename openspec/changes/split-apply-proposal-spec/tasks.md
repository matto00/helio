## 1. Baseline

- [ ] 1.1 Record the current total `sbt test` count (baseline) before any change
- [ ] 1.2 Record the current line count of `DashboardApplyProposalSpec.scala`

## 2. Extract shared fixture

- [ ] 2.1 Create `ApplyProposalSpecBase` trait in `com.helio.api` holding `beforeAll`/`afterAll`, seeded-id vars, and request helpers as `protected` members (imports are file-scoped, not inherited — each sibling file declares its own)
- [ ] 2.2 Make the base extend `AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols with BeforeAndAfterAll`; change private helpers to `protected`

## 3. Split test cases by feature seam

- [ ] 3.1 Keep core apply + shape/appearance cases (happy path, layout, HEL-292 aggregation, HEL-293 markdown/image/divider/chart/metric, invalid-type/blank-name/auth) in `DashboardApplyProposalSpec.scala` extending the base
- [ ] 3.2 Move V41 companion-binding + unknown/cross-user rejection cases into a rejection-focused sibling spec extending the base
- [ ] 3.3 Move HEL-316 v1.5 `config` passthrough parity cases into a config-parity sibling spec extending the base
- [ ] 3.4 Move HEL-321 timeline-sort cases into a timeline sibling spec extending the base
- [ ] 3.5 Move each `in { }` body verbatim — identical description strings and assertions; no semantic edits

## 4. Verify (Tests)

- [ ] 4.1 Run `npm run check:scala-quality`; confirm every resulting spec file and the base trait are comfortably under the ~250-line soft budget with zero new soft warnings
- [ ] 4.2 Run `sbt test`; confirm green and the total test count equals the 1.1 baseline (no tests dropped)
- [ ] 4.3 Confirm no production/schema/contract files changed (git diff is test-only)
