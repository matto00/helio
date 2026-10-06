## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `81452052d25b4f2d7d7ba299053a1d321916e134` (cycle-1 head `0bb28f2e4`; base `cdb9e43d669a1e3045ed6c3c15cf025a2547fe75`, resolved live).

The delta since cycle 1 touches four things:
- `OutputSummaryReducerSpec.scala`: a test-name change only.
- `PanelContent.metricHistory.test.tsx`: one fixture line.
- `red-green-evidence.md`.
- The committed `evaluation-1.md`.

No production code changed.

### Phase 1: Spec Review — PASS
- **CR1 (row cap): resolved.**
  - `red-green-evidence.md` now says there is no per-node cap on `node_snapshots`. It cites `overwriteRowsAction` and the real upstream bounds: `CsvLimits.maxRows` 50,000 (env), plus `CSV_MAX_CELLS`; `MaxRunRows` 1,000; `DatasetMaxRows` 500.
  - It states that join/union fan-out is unbounded.
  - The 120k / 60k numbers are relabelled as fixture sizes.
  - I verified these values against source in cycle 1.
- **CR2 (D5 guard): resolved and legitimate.** Full judgment under Phase 2.
- **CR3 (durable logs): resolved.**
  - All 14 durable paths cited in `red-green-evidence.md` exist and are non-empty under `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/`.
  - Some are summaries rather than full runs. For example, `gate-npm-test-frontend.log` is 147 bytes and `guard-d5-on-main.log` is 195 bytes, with no harness description. I don't need them as evidence: I independently re-ran the guard-on-main and red claims they summarize (below).
- The reducer test-name parenthetical is fixed: the test is now `"be null for a lone label mapping"`.
- Constraints:
  - C1 is now honored: every listed guard passes on main, and every red fails on main.
  - C2 and C3 are unchanged and honored.

### Phase 2: Code Review — PASS
Gates, re-run fresh at `81452052d` in `WORKTREE_PATH`:

| Gate | Result |
|---|---|
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| Root jest (`--maxWorkers=2`) | 375/375 |
| Frontend jest (`--maxWorkers=2`, run directly so the flag reaches it this time) | 4610/4610 |
| `npm --prefix frontend run build` | 0 |
| `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` | 6069 passed, 0 failed, 1 cancelled (the opt-in measurement spec); the renamed test ran |

`sbt --client shutdown` was run as a separate call after `testFull`.

**CR2 judgment: the fixture edit is legitimate and hides no coverage.** I checked this in a throwaway detached worktree at HEAD, removed afterwards.
- **What the test is for.** The test is about D5: under a client-fallback cross-filter over truncated rows, the panel keeps the loaded-rows value, ignores `filteredMetric`, and shows the HEL-588 disclosure. The old override `fieldMapping: {label: "region"}` was incidental. On main it triggered the lone-label bug, which is a different defect (D1).
- **The new fixture.** `{value: "amount", label: "region"}`, on top of `METRIC_CONFIG.aggregation {value: amount, agg: sum}`. It resolves to `amount/sum` on both main and branch. It keeps the `label: region` mapping.
- **Guard passes on main.** I put main's frontend production files in place and ran with ts-jest `diagnostics:false`. `PanelContent.metricHistory.test.tsx` passes in full on main.
- **The guard can actually fail.** Mutation test: in `PanelContent.tsx` I replaced `filteredMetric={isCrossFiltered ? undefined : filteredMetric}` with `filteredMetric={filteredMetric}`. The D5 test then fails ("Unable to find … 400"; it shows 9,999). Before the edit the fixture's field matched the injected `filteredMetric` only by accident. Now the field/agg genuinely match, so the guard really exercises the carve-out.
- **Lone-label coverage is still held by real reds.** In the same main-production run, all of these fail on main:
  - `PanelCard.filteredMetric` "shows no value for a metric whose only mapping is a label" (RTL, real chain).
  - `metricHistoryView` "never picks a lone label or unit mapping" and "aggregates aggregation.value for the {label} + aggregation shape".
  - All 6 `metricField` shared-fixture cases, including "lone label mapping with aggregation value".
  - On the server side, the Scala reducer and seam reds, verified in cycle 1 and unchanged.
- **What was lost.** One incidental thing: RTL-level coverage of the `{label}` + `aggregation.value` shape under a client cross-filter. That shape is still pinned at the resolver level on both ports. `MetricOutputPanel` takes its value column from that same resolver. The loss is acceptable.

Durable logs:
- `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/eval-c2-logs/c2-mutation.log`
- `…/eval-c2-logs/c2-on-main.log` (13 reds fail on main; D5 suite passes)
- `…/eval-c2-logs/c2-jest-summary.txt`
- `…/eval-c2-logs/c2-sbt-summary.txt`

### Phase 3: UI Review — PASS (carried forward from cycle 1)
The only `frontend/**` change since `0bb28f2e4` is the test file `PanelContent.metricHistory.test.tsx`; `git diff 0bb28f2e4 HEAD -- frontend backend/src/main schemas` lists nothing else. Nothing that renders changed. Cycle 1's live review at `0bb28f2e4` therefore still describes this head:
- Both themes.
- Viewer filter, lone-label metric, client cross-filter with the truncated-rows disclosure.
- Public route.
- Four breakpoints.

Screenshots are under `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/eval-c1-shots/`. No servers were started this cycle and no dev DB data was created.

### Overall: PASS

### Non-blocking Suggestions
- Suggestions carried over from cycle 1, still open:
  - Flatten the nested ternary at `MetricOutputPanel.tsx:85-104`.
  - Propose splits in the PR for the over-400-line files this change grew.
  - The PR body must state the D4 residual: raw API/MCP keep old stored values until retention ages them out.
  - The pre-existing silent fallback when a filtered page-0 fetch fails is a spinoff candidate.
- Optionally add an RTL case for the `{label}` + `aggregation.value` shape on `PanelCard.filteredMetric`. That would restore panel-level coverage of the editor's most common metric shape.
