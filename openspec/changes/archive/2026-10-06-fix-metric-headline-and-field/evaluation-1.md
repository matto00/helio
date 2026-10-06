## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `0bb28f2e43d018b1b314dd5b298b997a6e0bda25` (diff base `cdb9e43d669a1e3045ed6c3c15cf025a2547fe75`, resolved live by `resolve-review-base.sh`).
Owner rulings confirmed in `.concertino/runs/HEL-1326/events.jsonl`: `escalation.answered` with `answer_source: human`, `sub_answers: ["existing-disclosure","no-backfill"]` (D5, D4).

### Phase 1: Spec Review — FAIL

The product behavior matches the ticket, the design, and the four spec deltas (all verified live, see Phase 3). The FAIL is about the delivered evidence record: one ticked task was not done as written, and one guard is mislabelled.

- AC1 (filtered headline over the full filtered set): met. Both rows routes return `metric` (page 0 + filter + metric kind only). The panel shows it under a server-applied filter. A client-side cross-filter over truncated rows keeps the loaded-rows value, labelled by the HEL-588 disclosure (D5 `existing-disclosure`, no new copy, so C3 holds).
- AC2 (non-metric mapping never chosen; null on both sides): met. `OutputSummaryReducer.metricField` and `resolveServerMetricField` apply the same rule, pinned together by the shared `metricField` fixture category.
- AC3 (a test that fails without each fix): met. I re-ran the reds against main's production code myself (details under Phase 2).
- AC4 (backfill/note): owner ruled `no-backfill`. No V117 migration is in the diff (C2 holds). The "raw API/MCP keep old values" residual still has to go into the PR body; no PR exists yet, so this is for the orchestrator.
- Scope: no changes to `ci.yml`, `playwright.config.ts`, `.gitignore`, the pipeline-editor UI (`frontend/src/features/pipelines/ui/**`) or the history scrubber. The one `features/pipelines/**` file touched is `pipelines/services/outputService.ts`. It gets a `FilteredMetric` type and an optional `metric` field on `FetchOutputRowsResult`. Both are type-only, in a shared service module, not editor UI.
- **Issue 1: task 1.7 is ticked but its "node row cap" deliverable is wrong.** `red-green-evidence.md` says "Node row cap: 120,000 rows on the node". 120,000 is the measurement fixture's size (`OutputFilteredMetricMeasurementSpec.scala` `NodeRows = 120000`), not a cap. **No per-node row cap exists on `node_snapshots`.** `NodeSnapshotRepository.overwriteRowsAction` inserts every row it is given. No write path bounds it. Rows are bounded only upstream, per source:
  - CSV upload: `CsvLimits.maxRows` (env `CSV_MAX_ROWS`, default 50,000).
  - REST/SQL runs: `InProcessPipelineEngine.MaxRunRows` = 1,000.
  - Static/dataset sources: `DataSourceService.DatasetMaxRows` = 500.
  - Join/union steps can multiply these, and nothing caps the result.
- Does the gap matter? For shipping, no. I re-ran the measurement: 47 ms added on 120k rows, 60k matching. The read pulls one projected cell per row, and a node can never hold more rows than the run that wrote it already held in memory. For the record, yes. The design names this "unbounded filtered read" as its main risk, and task 1.7 asked for the cap specifically so the PR states the real bound. As written, the PR would state a false fact.
- **Issue 2 (C1 labelling):** see Phase 2, "guard mislabel".
- **Issue 3:** every `evidence/*.log` that `red-green-evidence.md` cites is gitignored (`.gitignore:27 *.log`), never committed, and never persisted. Only `gate-sbt-testFull.summary.txt` is tracked. These logs disappear when the worktree is cleaned up, so every cited red becomes a dangling reference.
- Constraints: C1 is mostly honored, with the one mislabel below. C2 and C3 are honored.

### Phase 2: Code Review — PASS (code), with the evidence-labelling issue above

Gates, all re-run by me in `WORKTREE_PATH` at `0bb28f2e4`:
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0. `node scripts/check-schema-drift.mjs`: in sync (122 schemas). `npm run check:scala-quality`: clean (soft warnings only).
- `npm test`: root 375/375, frontend 4610/4610. One deviation: `--maxWorkers=2` reached only the root jest invocation. The chained `npm --prefix frontend test` ran with its default worker count.
- `npm --prefix frontend run build`: exit 0.
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: 6069 succeeded, 0 failed, 1 canceled (the opt-in measurement spec). All four new or changed specs appear in the log. `sbt --client shutdown` was run separately.
- D3 measurement, re-run with `HELIO_MEASURE=1`: 78 ms without the metric, 125 ms with it, **47 ms added**, against a 500 ms bar. Matches the executor's 45 ms.

Red-first re-run. I used a throwaway detached worktree at HEAD with main's production files checked back out; the tests were kept and the worktree was removed afterwards:
- Scala, 17 fail on main:
  - 9 reducer/fixture failures, for example `{"agg":"sum","field":"name"} was not equal to {"agg":"sum","field":"amount"}`.
  - 8 route failures: `key not found: metric`, `None was not equal to Some(null)`, and public key set `TreeSet(items, limit, offset, total)` != `{…, metric}`.
  - Harness note: `NodeSnapshotRepository.scala` was kept at HEAD (an additive method, so the route specs compile) and the opt-in measurement spec was removed.
- TS: 6 `metricField` fixture failures and 4 `metricHistoryView` failures, matching reds 1, 3 and 5.
- RTL (ts-jest `diagnostics:false`, so the type-only additions compile on main):
  - `PanelCard.filteredMetric`: 3 fail ("Unable to find … 4,200", "--").
  - Public viewer: 1 fail ("4,200").
  - These match reds 6 and 7. Every executor red claim reproduced.
- **Guard mislabel (C1):** the test `PanelContent.metricHistory.test.tsx:113` "GUARD (D5 existing-disclosure) …" **fails on main**: "Unable to find an element with the text: 400"; main renders `0`. Its config overrides `fieldMapping: { label: "region" }`, so on main the lone-label bug aggregates `region` and shows 0. `red-green-evidence.md` lists it under "Guards (pass on main, not reds)", which is false. The D5 behavior it is meant to guard is correct on the branch. The failure on main comes from the unrelated D1 bug in its fixture.

Code findings (none blocking):
- The service layer is correct.
  - `OutputFilteredMetric.compute` gates on kind = metric, a resolved filter, and offset 0.
  - It is called after the ACL and `resolveFilter` steps on both routes.
  - It uses `findConfigsByIdsInternal`, and its Scaladoc gives the ACL-bypass justification CONTRIBUTING's ACL triad requires.
  - `listFieldCells` reuses `nodeFilterFragment` and `filterWhereFragment` (DRY with `listRowsPaged`), and orders by `row_index ASC` regardless of sort.
  - `Some(JsNull)` serializes as `"metric": null` and `None` omits the key. This is the spray absent-vs-null hazard from MISTAKES.md, handled deliberately and covered by tests.
- The schemas are additive and correct. History `metric` is required and nullable (the server always writes it). The MCP type adds it as optional.
- `MetricOutputPanel.tsx:85-104`: a four-level nested ternary for `filteredValue`. Lint passes, but it is hard to read. See suggestions.
- File-size budgets: six already-over-400-line files grew slightly:
  - `NodeSnapshotRepository.scala` (436 to 458)
  - `OutputService.scala` (477 to 478)
  - `PanelContent.tsx` (511 to 524)
  - `PanelCard.tsx` (824 to 825)
  - `panel.ts` (466 to 473)
  - `panelsSlice.ts` (431 to 435)

  CONTRIBUTING asks the PR description to propose a split in this case.
- `PanelCard.filteredMetric.test.tsx` mocks at the `getOutputRows` service function, not at HTTP as D7 says. `getOutputRows` and `fetchPublicPanelRows` pass `response.data` straight through, and the live UI review confirmed the wire seam end to end. Acceptable.
- A test name carries a stale rationale: `OutputSummaryReducerSpec` "be null for a lone label mapping (RED on main: it was picked and sum stored 0)". On main the fixture actually stores `45150` (label mapped to `amount`). It is still a genuine red, but the parenthetical is wrong.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` on 6758/9665 (assert-phase PASS) and stopped afterwards by exact PID (1203181, 1203162, 1202817, 1202550, 1202508).

**Hazard hit (MISTAKES.md "Parallel Playwright sessions share one browser"):** the shared MCP browser was being driven at the same time by another lane (HEL-1277's evaluator). About 4 s after my login, a dashboard "HEL-1277 eval dash 2" was created under my eval user's session. I stopped using the MCP browser and ran every reading below in my own headless Chromium, with a fresh context per scenario and `isolateLivePage` (about:blank) after login. The MCP browser reading I took before switching (62,500 under east) matched.

Fixture: a 500-row static source. `amount` = 1..500; `region` alternates east (odd) / west (even). The metric Output config is `{fieldMapping:{label:"region"}, aggregation:{value:"amount",agg:"sum"}}`, the editor's common shape that D1 fixes.

| Scenario | Dark | Light |
|---|---|---|
| Viewer filter east (server-applied) | **62,500** (full set; the loaded 200 rows would give 40,000), "250 results." | **62,500** |
| Filter changed in-app to west | **62,750** | (dark only) |
| Filter back to All | **125,250** (stored server headline; no stale filtered value) | (dark only) |
| Lone-label metric | "--" / "NO DATA" | "--" / "NO DATA" |
| Client-side cross-filter (chart click, region = east, same column as the control's eq, so client-fallback) over truncated rows (250 matching, 200 loaded) | **40,000** (loaded rows) + "200 of 200 loaded rows match." | same |
| Public share route, filter east | 62,500; the response carries `metric:{field:amount,agg:sum,value:62500}` | same |
| Public share route, unfiltered | 125,250; keys exactly `{items,limit,offset,total}` | same |

- Breakpoints, with the filter on: 1440 and 1100 (headline inside the card), 768 and 375 (mobile list, 62,500 shown). No horizontal overflow at any width.
- Console: no errors in any clean run. There were ECharts "Can't get DOM width" warnings on the public page; that code is untouched here. I also got 429s from the per-user rate limit, which my probing runs plus the other lane's traffic on the same user caused. Those runs were discarded and repeated.
- Durable screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/eval-c1-shots/{dark,light}-filtered-east.png`
  - `…/{dark,light}-crossfilter-truncated.png`
  - `…/public-{dark,light}-east.png`
  - `…/bp-375-filtered.png`
  - `…/bp-768-filtered.png`
- Durable logs: `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/eval-c1-shots/logs/` (red runs in full, the measurement, jest, and the sbt summary).
- Pre-existing unhappy path, not introduced here: when the page-0 filtered rows request fails (I hit a 429), the panel showed "east 20,100 / 500 results". That is the unfiltered first page's sum, under an east control, with no error shown. The same happens on main (`filterActive` falls back to the loaded value). It is a spinoff candidate, not a CR.

### Overall: FAIL

### Change Requests
1. `openspec/changes/fix-metric-headline-and-field/red-green-evidence.md` "D3 measurement": replace "Node row cap: 120,000 rows on the node" with what is actually true, and carry the same text into the PR body:
   - `node_snapshots` has **no** per-node row cap; `NodeSnapshotRepository.overwriteRowsAction` inserts every row.
   - The effective upstream bounds are `CsvLimits.maxRows` (env `CSV_MAX_ROWS`, default 50,000), `InProcessPipelineEngine.MaxRunRows` = 1,000 (REST/SQL) and `DataSourceService.DatasetMaxRows` = 500 (static/dataset).
   - Join/union fan-out is unbounded.
   - The 120,000-row fixture is 2.4x the largest single-source default.
   - The filtered metric read cannot exceed what the run that wrote the node already held in memory.
   - Then keep 120k / 60k / 45 ms as the measurement numbers, labelled as such.
2. `frontend/src/features/panels/ui/PanelContent.metricHistory.test.tsx:114`: remove the `fieldMapping: { label: "region" }` override, so the D5 test uses `METRIC_CONFIG`'s own field and is a true guard on main. Alternatively, keep the override and move the test into the reds table with its failing assertion on main ("Unable to find … 400"; main renders 0). Either way, the "Guards (pass on main)" list in `red-green-evidence.md` must contain only tests that pass on main (C1).
3. Make the cited red/green logs durable. Either run `scripts/concertino/persist-evidence.sh HEL-1326 openspec/changes/fix-metric-headline-and-field/evidence/<file>.log` for each cited log and cite the returned `ref=` paths in `red-green-evidence.md`, or state there that the logs are uncommitted (gitignored `*.log`) and local-only. Today the doc points at files that disappear when the worktree is cleaned up.

### Non-blocking Suggestions
- `MetricOutputPanel.tsx:85-104`: flatten the four-level nested ternary into a small named helper. For example, `filteredHeadline(filteredMetric, resolvedMetric): string | null` with early returns. That makes the D6 rule (match, mismatch, null + no-field, null value) readable at a glance.
- PR description: propose splits for the six over-400-line files this change grew (CONTRIBUTING "Code Standards / General").
- `OutputSummaryReducerSpec.scala:75`: fix the test-name parenthetical. On main this fixture stores 45150, not 0.
- PR body must state the D4 residual: raw API/MCP `current`/`points` keep old spurious stored values until retention ages them out.
- Spinoff candidate: a failed page-0 filtered rows fetch leaves the unfiltered loaded-rows aggregate under an active control with no error indication. Pre-existing on main.

### Evaluator environment notes
- Dev DB data I created, all under one throwaway user. Nothing was deleted.
  - User: `07485b24-9d5c-48ae-9d66-91f39f9a7930`, `hel1326-eval-c1-1791319495@example.com`.
  - Source: `0452d89d-cf2b-42ac-a3f0-ff4142dc6cd5`.
  - Pipeline: `31cf1f1b-0f43-422b-9ec6-89d7eb724aaf` (root `9df7e913-30b7-47ee-9877-cf8967c19650`).
  - Outputs: `c731642c-13bb-4074-8cdd-2706f2099895` (Eval Revenue), `dd2545cb-12d2-4a8e-84d3-1b438676b38d` (Eval LoneLabel), `05ed7667-4ef9-46b6-a9d5-edb5d07ff3a5` (Eval ByRegion).
  - Dashboard: `b3bb56d0-6022-4717-a541-8400142c4bad`.
  - Panels: `0efa5a42-2d5a-48f6-b239-800672bfe085`, `a0a7a239-eaa4-4c5f-9c4a-1d0fa87c054a`, `3ceb7d41-fcf3-4466-83b7-b73f19daea15`.
  - Share token: `3b9657b6-42b2-4373-a474-b6d96ec90929`.
- Created by the OTHER lane under my user's session via the shared MCP browser: dashboard `a71b4bee-554d-4b52-9429-948e8a9f6ad5` "HEL-1277 eval dash 2" (panels `fd3876cc-f946-4d3c-a666-3d7c4e911ec3`, `04dc759c-0bc2-4048-8e33-f692a29a5982`). It had disappeared from the list by my later runs.
- Playwright MCP wrote snapshot/console files to `/home/matt/Development/helio/.playwright-mcp/` (gitignored). I left them in place.
