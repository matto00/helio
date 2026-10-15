## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 13087b3b0c5d09589835e104313a5b446bf41ce6 against live-resolved base 453c57f1e71b5a5a06214cde68cbfd0cd9f992e0 (`resolve-review-base.sh`, origin/main).

### Phase 1: Spec Review — FAIL

- AC1 (echarts): PASS. The delta MODIFIES only "Chart panel renders a live ECharts instance". `grep -c typeId` on the delta returns 0, and the Purpose line is clean. HEL-1572's delta header is "Hover emphasis is subtle and respects reduced motion" (re-grepped in its worktree), so the two are disjoint. `openspec validate ... --strict` exits 0 (re-run). I spot-checked the delta's claims against the source and they hold:
  - The chart-type precedence comes from `resolvePanelChartType.ts:14-16`.
  - Aggregation is skipped when either the resolved type or the Output's `config.chartType` is non-aggregating: `ChartOutputPanel.tsx:102` plus `chartOverlay.ts:48`.
  - With no yAxis, numeric series are auto-detected (`chartDataOptions.ts:212-230`), and a pie uses the first numeric column (`chartDataOptions.ts:154-167`).
  - Heatmap and histogram skip the fallback (`chartDataOptions.ts:82-85`).
  - The canonical spec keeps the retitled scenarios with their old bodies until archive. design.md Decision 1 accepts this, since openspec cannot retitle a scenario through a MODIFIED delta.
- AC2 (usePanelPolling): PASS. The rename is mechanical. The only caller, `PanelCardBody.tsx:155`, already passes `outputId`. Test assertions are unchanged.
- AC3 (write-path-audit): **FAIL, one internal inconsistency.** In the edited "Session Call-Volume Estimate" table (`openspec/specs/write-path-audit/spec.md:152-160`):
  - The rows "Panel repositions (drag) | 5 | 5 × PATCH dashboard layout" and "Panel resizes | 3 | 3 × PATCH dashboard layout" still claim one PATCH per drag/resize.
  - The new "Auto-save flushes" row and the new Total ("3 layout + ...") instead count layout only per flush. That matches row 1 and the Key-observation paragraph the executor aligned.
  - So the table now contradicts itself: its rows add up to 8 layout PATCHes while its total counts 3.
  - Everything else matches the code: rows 7/8/9, the payload details, the Source Locations rows and the delta scenario. I verified `accumulatePanelUpdate` at `PanelDetailModal.tsx:135` and `usePanelTitleEditing.ts:37`; `updatePanelsBatch(buildBatchRequest(...))` at `usePanelUpdatesFlush.ts:93`; the `{fields, panels}` return of `buildBatchRequest`; and `swapPanelOutput` at `OutputPicker.tsx:134`.
- AC4 (CLAUDE.md): PASS. I re-ran the probe myself on this worktree's backend (port 9953), signed in as matt@helio.dev:
  - `GET /api/dashboards/49d27263-.../panels` returns 200 with 3 items signed in and 404 unauthenticated.
  - `ea1a1d3d-...` returns 200 with 1 item signed in and 404 unauthenticated.
  - The only `dashboards/<id>/panels` route is `PublicDashboardRoutes.scala:60`, mounted under `optionalAuthenticate` at `ApiRoutes.scala:823-825`.
  - So the doc was wrong and the code is right. Only that line changed.
- AC5 (dead code): PASS.
  - At base, `git grep segmented` outside CSS hits only the lock test.
  - `metricOptions` now has 0 hits in `frontend/src` and `e2e`. The only non-test call site, `OutputPanelContent.tsx:245`, never passed it.
  - After my own build, no `dist/assets/*.js` or `*.css` contains `panel-detail-modal__segmented`. No source ever produced the class, so nothing rendered changes.
  - The CSS-lock describe block was removed honestly.
  - The duration-test deletion is justified: the adjacent bound-unit test at `MetricRenderer.duration.test.tsx:97` already covers that behaviour.
- Tasks all marked done and match the implementation. No scope creep. Constraints C1–C7 are honoured: no behaviour, API or schema change; no HEL-1572 or concurrent-lane files touched; evidence.md has a command and output per claim; servers were stopped via the canonical script.

### Phase 2: Code Review — PASS

I ran the gates myself in WORKTREE_PATH under `nice -n 19` with `HELIO_JEST_MAX_WORKERS=3`:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- `npm test`: exit 0. Root suite: 51 suites, 469 tests passed. Frontend: 612 suites, 7265 tests passed.

No backend files changed, so `sbt testFull` was not triggered.

The code diff is minimal and clean:
- The rename is complete, including the dependency array.
- `buildMetricItem` loses its dead parameter and the stale `itemOptions.metric` doc sentence.
- No dead imports are left behind. `CollectionRenderer.test.tsx` still uses its imports.
- There is nothing to flag against the CONTRIBUTING or DESIGN mechanical rules: CSS was only deleted, and no new tokens were added.

### Phase 3: UI Review — PASS

Triggered by `frontend/**` and `openspec/specs/**`. I started servers via `start-servers.sh` (7046/9953) and confirmed with `assert-phase.sh servers` PASS.
- Signed in, the "Helio Roadmap" dashboard renders its panels.
- The "Revenue by Region" chart Output in an `output` panel mounts one ECharts instance.
- At 768px, the panel's Customize (detail) modal opens. It has 0 elements matching `[class*="segmented"]` and no horizontal overflow.
- Console: 0 errors and 0 warnings across all flows.

Servers were stopped via `stop-servers.sh` (`STOPPED ports=7046,9953`).

Side note, not a finding: the Playwright MCP tool writes its own page-snapshot and console `.yml`/`.log` files into the main checkout's gitignored `.playwright-mcp/`. That is the tool's behaviour, not a write by this review.

### Overall: FAIL

### Change Requests
1. Fix the two stale rows in `openspec/specs/write-path-audit/spec.md`, "Panel repositions (drag) | 5 | 5 × PATCH dashboard layout" and "Panel resizes | 3 | 3 × PATCH dashboard layout" (Session Call-Volume Estimate, about lines 152-153). Restate them the same way the renames/appearance row was restated, e.g. "Panel repositions (drag) | 5 | staged; folded into the flushes (no per-drag call)" and the same for resizes. That makes them agree with row 1 ("at most 1 per flush (no debounce)"), the Key observation, and the Total, which counts only 3 layout PATCHes. Re-check that the Total still sums, then add a verification line to evidence.md section C (e.g. `grep -n 'PATCH dashboard layout' openspec/specs/write-path-audit/spec.md`, showing only flush-based rows).

### Non-blocking Suggestions
- Row 7's payload `{ fields: string[], panels: [{ id, title?, appearance? }] }` leaves out the `type?` that `buildBatchRequest` can also carry. That is accurate for the two triggers listed, so it is optional.
