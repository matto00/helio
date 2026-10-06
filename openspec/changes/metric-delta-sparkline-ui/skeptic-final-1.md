## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2f677e8d0e9b0ec9a6f43c449047b63363c23da2`. The base was resolved live by `resolve-review-base.sh`: `2c49bdba8ffe0df5df65b2c951c0b9bb73173c2b`. The diff is 44 files, all frontend, e2e and openspec. There are no backend, workflow or `playwright.config.ts` changes and no migration (C1 holds).

### What I verified (with evidence)

**Spawn guard**
- `assert-cwd.sh` returned `READY`.
- `assert-phase.sh servers … 6707 9614` returned `PASS servers`.
- The cwds of pids 7896 and 7435 resolve to this worktree's `frontend/` and `backend/`. I reused them and killed nothing.

**Gates, run fresh by me under `nice -n 19`**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | exit 0 |
| Full jest | exit 0, 434 suites / 4519 tests passed |

None of FirstRunRoutesSpec, "Java heap space", HEL-1294 or HEL-1298 came up. No backend gate applies.

**Exit-criterion e2e**
- I ran a byte-identical copy of `e2e/hel1275-metric-delta-sparkline.spec.ts`, plus its `historySeed.ts` helper, from a scratch dir. It ran with `DEV_PORT=6707`, at most 2 workers, under nice.
- Running from scratch meant the spec's screenshots landed outside the worktree.
- Result: 2/2 passed (light and dark). It reads "1,204", "▲ 12% vs 7d", shows the sparkline and the "Compared with" row with 1,075, at default 3x2 size at 1440 and 1100. Compare was chosen in the editor UI (C5).

**Red-first proofs I ran myself**

Jest mutations were applied to a scratch copy of `frontend/`; the worktree was not modified.

| Guard | Mutation | Result |
| --- | --- | --- |
| Filter guard, PanelContent | `filterActive={false}` | RED, 3 tests |
| Filter guard, view | `if (filterActive)` → `if (false)` | RED, 4 tests |
| Metric identity, head point | head check removed | RED, 2 tests |
| Metric identity, sparkline points | match filter removed | RED, 1 test |
| Metric identity, stale baseline | stale-baseline check removed | RED, 2 tests |
| `compare: null` on None | null becomes an omitted key | RED, 2 tests (editor sheet and aggregate tail) |
| Sparkline needs ≥2 points | threshold changed to ≥1 | RED |
| Public route | URL swapped | RED |
| Filtered marker only when a comparison would show | marker always shown | RED |
| Rendering | flat counted as up; ▼ glyph swapped; available-from note removed (type-safe); available-from copy changed; "previous" label changed to "previous run"; headline forced to the loaded-rows value; editor's initial compare ignored | RED for each |
| Sparkline visibility at default 3x2 | cycle-1 CSS (`display:none` in the compact container query) injected with `page.addStyleTag` into a copy of the e2e | RED: `toBeVisible()` on "Trend over N data points" fails with element not found |
| Provenance publisher | `MetricOutputPanel` forced to always publish a comparison | **GREEN, 168/168.** Nothing tests the publisher side. See CR2. |

**ACs and spec, traced to code**
- **▲/▼/flat:** `metricHistoryView.ts` sets the direction; `MetricRenderer.tsx` `ComparisonLine` renders it. Tests are in `MetricRenderer.test.tsx` and `metricHistoryView.test.ts`.
- **Available-from note:** `ComparisonLine` renders it; tests are in `PanelContent.metricHistory.test.tsx`.
- **Delta hidden under a filter:**
  - `PanelContent.tsx` computes `filterActive` as `viewerFilterActive || crossFilterMode === "server" || isCrossFiltered`. `"server"` only occurs while a cross-filter is active (`useCrossFilterServerOps.ts`).
  - All four call sites pass `controlFilterOps.length > 0`: `PanelCard`, `PanelDetailModal`, `PanelFullscreenOverlay` (computes the same ops itself) and the public page.
- **Server headline:**
  - `resolveServerMetricField` matches `OutputSummaryReducer.metric` line for line (single string mapping, then `fieldMapping.value`, then `aggregation.value`, with non-empty strings), at `OutputSummaryReducer.scala:82-103`.
- **No "previous run" copy:** none in the UI. The label is "previous" and the aria text is "versus the previous point".

**Public path, live**
- I seeded my own dashboard with a share token. On the public page:
  - The only history requests were `/api/dashboards/<d>/panels/<p>/history?token=`.
  - The output and pipeline ids are not in the DOM.
  - The public history payload has no `outputId`, `runId` or `triggerSource`.
- Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1275/evidence/openspec/changes/metric-delta-sparkline-ui/screenshots/skeptic-final-1-sk-public-dark.png`

**Visual check, running app, default 3x2, light and dark**

Screenshots:
- `…/screenshots/skeptic-final-1-sk-dash-1440-light.png`
- `…/screenshots/skeptic-final-1-sk-dash-1440-dark.png`
- `…/screenshots/skeptic-final-1-sk-prov-dark.png`

Findings:
- The compact layout reads well: value, then the delta and a short sparkline on one row, with the footer intact.
- Measured sizes: the delta is 10px mono on `--app-success`, and the sparkline is 48x16 in the accent stroke. Both themes match.
- The provenance popover's "COMPARED WITH  7 days ago · 1,075" row matches its siblings' heading and value styles.
- The unfiltered state looks cohesive. I have no design objection there.

**Filtered state, live: the defect**
- I added a text viewer control (Region) and typed "west"; the panel's own status line reads "1 result."
- The metric then shows "-- / NO DATA / Comparison hidden" instead of 600. Light and dark both reproduce it, so it is a stable result, not one bad reading.
- Screenshots:
  - `…/screenshots/skeptic-final-1-sk-filtered-light.png`
  - `…/screenshots/skeptic-final-1-sk-filtered-dark.png`
- The provenance popover on the filtered panel correctly shows no "Compared with" row.

**Cleanup**
- Every row I created was deleted by exact id, and the DB shows a count of 0 for each:
  - dashboards `b94cd07e…` and `fdd1c472…`
  - pipelines `27a003d5…` and `9596059f…`
  - sources `09e422a4…` and `2c6e4a83…`
- History for output `08b28c04…` is gone with them.
- Two test users remain, because there is no self-delete route (the evaluator left the same kind of residue).

### Verdict: REFUTE

### Change Requests

**1. The filtered-state headline does not show the filtered rows' value for the metric shape the editor writes.** This is a spec divergence, and it shows up on the exit-criterion panel itself.

- **Where:** `frontend/src/features/panels/ui/MetricOutputPanel.tsx:55`, `const valueColumn = Object.values(cfg.fieldMapping)[0];`.
- **What the spec says:** this change's own spec, "Active viewer filter hides the comparison", requires that the panel "SHALL show the headline computed from the filtered rows".
- **Root cause:**
  - `buildOutputConfig` writes `fieldMapping.value` only when no aggregation is chosen (`buildOutputConfig.ts`, the `metricAggFn === ""` branch).
  - So any aggregated metric made in the editor stores `fieldMapping: {}` plus `aggregation: {value, agg}`. That is exactly the shape the e2e seeds and the HEL-918 exit criterion describes.
  - For that shape, `valueColumn` is `undefined` and `loadedValue` is `""`.
- **Effect:** the moment a viewer applies any filter, "1,204 ▲ 12% vs 7d" becomes "-- No data · Comparison hidden", even though the filtered row set is not empty. Design D3's own rationale was that an unfiltered headline would make viewer controls inert on metrics; this outcome is worse than inert.
- **Why the tests miss it:** the unit fixture `historyFixtures.ts` `METRIC_CONFIG` uses `fieldMapping: {value: "amount"}` together with `aggregation`, a shape the editor never produces.
- **The bug is older than this branch:** on main the loaded-rows headline is already "--" for this shape. But this change rewrote this exact block into a new file and wrote a requirement over it, so this is where it gets fixed.
- **Fix:**
  - Resolve the loaded-rows value column with the same rule as the server (`resolveServerMetricField(config)?.field`, already exported from `metricHistoryView.ts`).
  - Add a filtered-state test using the editor's shape (`fieldMapping: {}`, `aggregation: {value: "amount", agg: "sum"}`) that asserts the filtered sum, for example 600 for one row.
  - The test must fail before the fix and pass after it.

**2. The "No compared-with row under a filter" scenario has no failable guard on the publisher side.**

- The test `ProvenanceTrigger.comparedWith.test.tsx` "shows no row when nothing is published (no delta, or hidden by a filter)" publishes `null` by hand. It never exercises the path where a filter makes the panel publish `null`.
- My mutation forced `MetricOutputPanel.tsx` (the `publishComparison` value at about :79) to always publish a comparison. All 168 changed-area tests stayed green.
- The behavior is correct live today. The test still needs to fail when that behavior breaks.
- **Fix:** in `PanelContent.metricHistory.test.tsx`, assert `getPublishedComparison("authenticated:<panelId>")` is non-null with no filter and `null` with an applied filter. Show that it goes red under the mutation above.

### Non-blocking notes

- **psql dependency in CI.** `e2e/support/historySeed.ts` is the first e2e helper that shells out to `psql`. The CI `e2e` job sets `DATABASE_URL`, `DB_USER` and `DB_PASSWORD` (`ci.yml:341-343`), and `ubuntu-latest` ships a PostgreSQL client. But the branch has never run in CI (not pushed). Watch the first CI e2e run; if `psql` is missing, the helper fails loudly.
- **Misplaced CSS comment.** The "1.5px is a literal…" comment in `PanelContent.css` sits above `.panel-content__metric-meta` rather than the sparkline rule it describes. The evaluator raised this too.
- **Controls overflow at default size.** A metric panel with a viewer control at default 3x2 overflows its card (`sk-dash-1440-*`). That comes from the control bar, not from this change, and is a candidate follow-up.
- **Scope addition in `OutputEditorSheet.tsx:233`.** The aggregated-metric field now seeds from `aggregation.value`, which fixes a pre-existing drop of the aggregation on save. It is reasonable and needed for C5's editor-driven compare save, but it is not listed as a scope addition in the proposal. Mention it in the PR body.
