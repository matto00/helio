## Standing Constraints

- [C1] Every `authorizeResourceWithSharing(...)` call stays literally in `PublicDashboardRoutes.scala`; no module calls or wraps it (ExistenceNotLeakedRoutesSpec guard).
- [C2] Zero diff under `backend/src/test`; total and related-suite test counts equal the b2a0d8088 baseline.

## 1. Baseline

- [x] 1.1 On the unmodified worktree run `nice -n 19 sbt testFull` (timeout 600000, <=2 workers), log to scratchpad `hel1291-baseline-testfull.log`; record total + related-suite counts (design D6)
- [x] 1.2 Extract the ordered route-tree skeleton (design D5a) to scratchpad `hel1291-route-tree-before.txt`; record the `filesCallingAccessHelpers` scan (D5d)

### Backend

## 2. Split

- [x] 2.1 Create `PublicPanelOutputResolver` with `resolvePanelOutput` moved verbatim; compiles
- [x] 2.2 Create `PublicPanelListResolver` (validator, dataAsOf, orphaned-controls, panel-list resultF body) verbatim; compiles
- [x] 2.3 Create `PublicPanelRowsResolver` (resolveRows, resolveFilterCapabilities, resolveDistinctValues) verbatim; compiles
- [x] 2.4 Create `PublicPanelOutputMetaResolver` (resolveOutputMeta, resolveProvenance) verbatim; compiles
- [x] 2.5 Create `PublicPanelHistoryResolver` (resolveHistory) verbatim; compiles
- [x] 2.6 Reduce `PublicDashboardRoutes` to constructor + module wiring + the unchanged directive tree delegating to modules; `node scripts/check-scala-quality.mjs` passes
- [x] 2.7 Update `api/routes/dashboards/README.md` Holds list

### Tests

## 3. Evidence

- [x] 3.1 Write `route-tree-evidence.md`: D5a skeleton before/after + diff + endpoint table, D5b red run, D5c color-moved verbatim check, D5d guard scan
- [x] 3.2 Run `nice -n 19 sbt testFull` again; totals and related-suite counts equal baseline, incl. ExistenceNotLeakedRoutesSpec green; write `test-count-evidence.md`
- [x] 3.3 Confirm `git diff <base>...HEAD -- backend/src/test` is empty and pre-commit hooks pass on commit
