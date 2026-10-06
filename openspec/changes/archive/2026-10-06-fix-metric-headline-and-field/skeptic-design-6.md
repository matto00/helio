## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Reviewed at HEAD cdb9e43d669a1e3045ed6c3c15cf025a2547fe75 (= origin/main after the fast-forward). The change dir is
untracked on top of it. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/metric-headline-field-correctness/HEL-1326`.
`openspec validate fix-metric-headline-and-field --strict` → "Change 'fix-metric-headline-and-field' is valid".

### What I verified (with evidence)

**Citations and edit targets on cdb9e43d6**
- `OutputSummaryReducer.scala` `metric` (:87-103) still has `if (mapping.size == 1) mapping.headOption`. The bug is
  present, so D1 is needed. `metricHistoryView.ts` `resolveServerMetricField` (:21-34) still has
  `strings.length === 1 ? strings[0]`.
- Public rows path: `PublicPanelRowsResolver.resolveRows` (:48-96) takes `outputRepo: OutputRepository`, which is
  plain (not `Option`), as D2 says. It calls `outputRepo.findByIdInternal`, `PublicOutputControlScope` validation,
  `OutputRowsQuery.resolveSort`/`resolveFilter` and `listRowsPaged`, and returns `PagedResult[JsValue]`.
  `PublicDashboardRoutes.scala` (now 218 lines) builds it at :55 and calls it at :92. D2's public bullet is accurate.
- `OutputRepository.findConfigById` (:144), `findConfigsByIdsInternal` (:156) and `findByIdInternal` (:128) all exist.
  `OutputService.rows` (:331-368) has the shape D2 assumes.
- `OutputRowsResponse(items, total, offset, limit, materialized)` is at `OutputProtocol.scala:74`. Task 1.3 puts
  `metric` last, after `materialized`.
- `ResolvedHistoryPoint(capturedAt, rowCount, value)` is at `OutputHistoryService.scala:16`. It is serialized by
  `OutputHistoryProtocol.scala:94-95` as exactly `{capturedAt,rowCount,value}`, which is D4's edit target.
- `check-schema-drift.mjs` pairs schemas to case classes by schema `title`, uses the non-balanced regex
  `/case class\s+(\w+)\s*\(([^)]*)\)/gs` (:55), and scans `api/protocols/**` recursively (:83). D2's
  `metric`-last / `api/protocols/**` / title rationale is accurate.
- Frontend: pageSize 200 is still at `usePanelData.ts:160,187` and `usePanelSortFilter.ts:139`.
  `useCrossFilterServerOps.ts:84` is `client-fallback`. In `PanelContent.tsx` the client narrowing is at ~:230-249 and
  `LoadedScopeDisclosure` at ~:365-372; both are within a few lines of the citations. `LoadedScopeDisclosure.tsx:54`
  renders "{matchCount} of {loadedCount} loaded rows match.", the D5 ruling's copy.
- `OutputHistoryCostMeasurementSpec`, `OutputSummaryReducerSeamSpec`, `aggregate.fixture.test.ts`,
  `shared-test-fixtures/output-summary-reducer.json` and `usePublicPanelData.ts` all exist.

**MODIFIED blocks preserve the current requirements.** I extracted each requirement block from `openspec/specs/**`
and from the delta and ran `git diff --no-index --word-diff`.
- `output-history-api` "Comparison resolution":
  - The only body change is an insertion after "`null` when the summary has none": the `metric` read-out sentence and
    "SHALL NOT change which point is selected".
  - All 8 current scenarios are kept verbatim, including HEL-1290's "A point exactly at the window boundary is the
    baseline".
  - Two scenarios are added.
- `metric-history-delta-ui`:
  - "Metric headline uses the server all-rows value…" is insertions only, plus 4 added scenarios.
  - "Metric delta shows…": the one replaced clause, "baseline is not a returned point whose … differs from", is
    deliberately widened to the `baseline.metric` identity, keeping a fallback to the returned points. One scenario is
    added.
  - "Active viewer filter hides the comparison": "headline computed from the filtered rows" is replaced by a
    cross-reference. Both scenarios are kept.
  - Nothing else is dropped.

**ADDED output-snapshot-history requirement vs. the recent edit.**
- HEL-1343 (`f78b4c518`) touched only "History repository primitives", the lock-held skip.
- The current "Summary reducer matches the frontend aggregation" requirement states no field-selection rule.
- So the ADDED "Metric field selection never picks a label or unit mapping" contradicts nothing.
- `output-routes-api` "GET /api/outputs/:id/rows" and `public-dashboards` "Public row read" have no closed key-set
  wording that an additive `metric` key would violate.

**Rulings.**
- D5 `existing-disclosure` is quoted verbatim in the delta-ui spec (:12) and design D5 (:89). Task 2.6 is a guard
  only, with no new copy, and constraint C3 is recorded.
- D4 `no-backfill`: design D4 (:80) says no V117. C2 is recorded and the Non-goals exclude the rewrite.
- The specs and design decide nothing beyond these rulings.
- **But proposal.md was not updated: see CR1–CR3.**

**HEL-1327 item 1 is red on main.**
- Task 3.3 asserts `baseline.metric` on an out-of-window 30d baseline.
- On cdb9e43d6 the resolved-point serializer (`OutputHistoryProtocol.scala:94-95`) emits no `metric` key.
- So any assertion on `baseline.metric` fails on main by construction (key absent).
- `OutputHistoryRoutesSpec` already builds points at arbitrary `capturedAt` (`ago(T, days = …)`), so the fixture is
  constructible.
- Baseline selection is unchanged and labelled a GUARD, as C1 requires.
- I did not run sbt: the test does not exist yet, and the red rests on the serializer's literal key set.

### Verdict: REFUTE

The design, tasks and spec deltas are sound and current on cdb9e43d6. proposal.md (and one design risk line) still
describes the pre-ruling, pre-HEL-1291 state. It contradicts the recorded owner ruling and names a stale edit target.
The orchestrator asked for exactly these two things to be checked. Each fix is a one-line edit.

### Change Requests
1. `proposal.md:17-18` says the cross-filter labelling "is pending an owner ruling (design.md D5)". This contradicts
   design D5, the delta-ui spec and C3, which are all ruled `existing-disclosure`. Restate it: the client-side
   cross-filter keeps the loaded-rows value, labelled by the existing HEL-588 "N of M loaded rows match." disclosure
   (owner ruling D5, no new copy).
2. `proposal.md:34` (Impact) lists the "`PublicDashboardRoutes` rows path". Since HEL-1291 the edit target is
   `PublicPanelRowsResolver.resolveRows` (`backend/src/main/scala/com/helio/api/routes/dashboards/PublicPanelRowsResolver.scala`).
   Name it, plus the new `PublicPanelRowsResponse` under `api/protocols/**`.
3. `proposal.md:44` (Non-goals) still says the backfill needs an "(owner ruling required)". Replace that with the
   recorded ruling: `no-backfill`, no V117, and the residual on raw API/MCP values is stated in the PR.
4. `design.md:113` (Risks) says "PublicDashboardRoutes is 506 lines, HEL-1291 … the route adds one call". It is now
   218 lines and the rows logic lives in `PublicPanelRowsResolver`. Update the risk so the resolver is the thing that
   gains the one service call.

### Non-blocking notes
- Optional: `design.md:3` / `proposal.md:3` say "Verified on main at 0614c979". The citations still hold at cdb9e43d6
  (above); restating the base would avoid confusing the final gate.
- Optional: the `OutputSummaryReducer.scala:88-102` and `metricHistoryView.ts:23-35` line ranges are off by about 1.
  Live: :87-103 and :21-34.
