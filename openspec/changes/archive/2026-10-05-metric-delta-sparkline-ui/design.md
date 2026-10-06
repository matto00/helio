## Context

L3 (HEL-1273) serves `GET /api/outputs/:id/history` (`OutputRoutes.scala:89`) and the public
`GET /api/dashboards/:d/panels/:p/history?token=` (`PublicDashboardRoutes.scala:412`). Wire shape
(`OutputHistoryProtocol.scala`): `compare`, `current`/`baseline` `{capturedAt,rowCount,value}`, `delta`, `pct`,
`availableFrom`, `sparkline[{capturedAt,value}]` oldest-first, `points[]` newest-first with `summary` (same points,
reversed); authenticated adds `outputId`, `runId`, `triggerSource`. `value` is null for non-metric kinds. Today
`PanelContent`'s metric branch computes the headline over the ≤200 loaded rows; `MetricRenderer` has an unused
`data.trend` slot styled `.panel-content__metric-trend--up/down/flat` (`--app-success`/`--app-error`/
`--app-text-muted`). `PATCH /api/outputs/:id` shallow-merges config (`OutputService.mergeConfig`): an omitted key is
kept, an explicit `null` clears it. Nothing in `frontend/src` reads history yet.

## Goals / Non-Goals

Goals: the spec's requirements, consuming L3 unchanged. Non-goals: see proposal; no backend edits, no migration.

## Decisions

**D1 History service + shared cache.** New `features/panels/history/outputHistoryService.ts` (typed authenticated
and public fetchers) and `outputHistoryCache.ts` modelled on `provenance/provenanceCache.ts`: module-level, keyed
`output:<id>` / `public:<d>:<p>`, shared in-flight promise, generation counter, hook `useOutputHistory(source,
pipelineId?)`. Authenticated keys invalidate via `subscribeToPipelineTerminal` (`pipelineRunFanout.ts`) exactly as
`ProvenanceTrigger.tsx:106` does; public keys never subscribe (fetch on mount, like public provenance). Fetched only
when `output.kind === "metric"`. Redux rejected: per-panel, read-only, and provenance already set this pattern.
Race: the run's `succeeded` event is published (`PipelineRunService.scala:1395`) before the history write, so a
fan-out refetch can read the pre-run head; if a refetch's `current.capturedAt` did not advance, retry once after
1.5 s (unit-tested). Rows have the same pre-existing race (`usePanelRunRefresh`).

**D2 Server headline + metric-identity guard.** Pure `resolveServerMetricField(config)` ports
`OutputSummaryReducer.metric`'s rule exactly (one fieldMapping string → it; else `fieldMapping.value` ??
`aggregation.value`; agg = `aggregation.agg` or null). A point *matches* when its `summary.metric.{field,agg}` equal
that resolution. Pure `selectMetricHistoryView(history, config, filterActive)` returns:
- headline: `current.value` iff not filtered, `current.value != null` and `points[0]` matches; else null (caller keeps
  today's loaded-rows value);
- sparkline: only `sparkline` entries whose same-`capturedAt` point matches and whose value is non-null (≥2 to draw);
- comparison: none unless the head matches; `delta` hidden when the baseline's `capturedAt` appears in `points` with
  a non-matching metric; the available-from note likewise only when the head matches.
Known limitation: a baseline older than the 30 returned points cannot be identity-checked client-side (L3's
`resolveBaseline` does not filter by metric identity) — follow-up against L3, noted in the PR. This guard compares the
server summary against the server's own rule on the current config, so it detects edits since the run; it does not
"reconcile" the client's `Object.values(fieldMapping)[0]` choice — it simply prefers the server value when valid.
Fetch uses default `limit` 30 and no `since`, so `points[0]` is the head.

**D3 Filtered state = an applied filter.** `viewerFilterActive` (new optional `PanelContent` prop) is
`buildViewerControlFilterOps(controls, values).length > 0` — the same `controlFilterOps` each call site already sends
with the row fetch (`PanelCard.tsx:184`, `PanelDetailModal.tsx:177`, `PublicDashboardViewerPage.tsx:68`, and the
fullscreen overlay's equivalent) — OR a cross-filter narrowing this panel (`crossFilterMode === "server"` with an
active cross-filter from another panel, or `OutputPanelContent`'s existing client-fallback `isCrossFiltered`).
Empty/unparsable control values build no ops and so do not count. When active: headline = loaded (filtered) rows;
delta, note and sparkline are replaced by a muted focusable marker (`tabIndex=0`, native `title` per DESIGN.md §5,
plus `aria-describedby` text) "comparison reflects unfiltered data", only when a comparison would otherwise show.
Reading confirmed by the design skeptic: an unfiltered headline would make viewer controls inert on metrics.

**D4 Public source.** New optional `PanelContent` prop `historySource?: { variant: "public"; dashboardId: string;
token: string }`, set only by `PublicDashboardViewerPage`; absent → authenticated key `output:<outputId>`.

**D5 Provenance "Compared with" without new call-site props.** New `features/panels/history/
metricComparisonStore.ts`: `OutputPanelContent` publishes the resolved comparison for its panel —
`{ baselineAt, baselineText }` or null — keyed `<variant>:<panelId>`, per publisher id (effect; removed on unmount),
readers taking the most recent live publisher (card + fullscreen of one panel compute identical views: viewer
controls are URL-backed). `ProvenanceTrigger` (already has `panelId` + `variant` at all six call sites) reads it via
`useSyncExternalStore` and passes it to `ProvenancePopover` → `ProvenanceContent`, which renders "Compared with <time>
· <value>" (time element like `LastRunRow`'s). Published value is null whenever D2/D3 hide the delta, so a filtered
panel shows no row. Touches only `ProvenanceTrigger.tsx`, `ProvenancePopover.tsx`, `ProvenanceContent.tsx`.

**D6 Rendering.** `MetricRenderer` gains optional structured `comparison` (union `delta | availableFrom | filtered`)
and `sparkline` props; the legacy `trend` string path stays. The delta reuses the trend element and modifiers
(spec `metric-panel-trend-indicator` unchanged). Glyphs ▲/▼/flat "▬" are `aria-hidden`; the element has an
`aria-label` such as "up 12% versus 7 days earlier". Percent: absolute, `Intl.NumberFormat` max 1 fraction digit;
pct null → absolute delta in the headline's format. Labels: `previous_run` → "previous", `1d|7d|30d` verbatim,
`custom:P3D` → "3d", `PT6H` → "6h", else "custom". Available-from via `toLocaleDateString`. Sparkline: inline SVG
polyline (no ECharts per metric panel), stroke `var(--app-accent)` (the decoration token; `--app-accent-text` is
text-only per HEL-1048) at a literal 1.5px (no stroke-width token exists; thin enough to stay secondary to the value),
non-text 3:1 contrast checked in both themes; `role="img"` + `aria-label`; hidden in the compact container query.

**D7 Compare picker.** `MetricKindFields` (`OutputKindFields.tsx`) gets a `Select`: None/Previous/1 day/7 days/30
days, plus "Custom (<raw>)" when the loaded value is `custom:*`. State beside `metricFormat` in `OutputEditorSheet`.
Metric `buildOutputConfig` emits `compare` always — the picker value, or a literal `null` for None (an omitted key
would silently keep the old value under the shallow merge). Other kinds omit the key (the merge keeps it).
`buildAggregateTailConfigs` is create-only (`OutputEditorSheet.tsx` ~364), so its metric `outputConfig` takes the
picker value as a new param. Server validation (`OutputCompare.validateConfig`) 400s surface via the save error.

**D8 E2E proof.** `e2e/hel1275-metric-delta-sparkline.spec.ts`, both themes: register/login, `page.goto
("about:blank")` before any API seeding (HEL-1289); seed via API a dataset source → pipeline → metric Output
`{sum, format: "integer"}` with NO compare → dashboard panel; real run #1 with data summing to 1075; backdate that
output's history rows (selected by the `output_id` this test created, ids recorded) to latest − 7d − 1h via
`e2e/support/historySeed.ts` (`psql`, jdbc→libpq URL; `DATABASE_URL`/`DB_USER`/`DB_PASSWORD` from env, falling back
to the worktree `backend/.env`; runs `SET LOCAL app.current_user_id` to the test user so FORCE RLS passes for a
non-superuser too; asserts affected-row count; fails loudly, never skips); change data to sum 1204; real run #2
(synchronous: the 200 returns after the history insert). Then in the UI open the Output editor, choose "7 days",
save (C5), open the dashboard and assert "1,204", "▲ 12% vs 7d", the sparkline and the provenance "Compared with"
row; screenshots in both themes into the change dir. Cleanup by exact recorded ids.

## Risks / Trade-offs

- [Backdating moves only `captured_at`] → rows come from real runs; a mocked route was rejected (hides the seam).
- [L2 thinning] → one point per bucket survives D4's buckets; asserted before render.
- [N metric panels → N requests] → one per panel, shared with provenance.
- [Filtered headline still ≤200 rows; baseline older than returned points unchecked] → follow-ups noted in the PR.

## Planner Notes

Self-approved: filtered headline = filtered rows (skeptic-confirmed), cross-filter counts as a filter, picker on
metric only (L7 owns other kinds), "previous" label (HEL-1285 open), psql seeding (no new package). The driver's
claim of two comments on HEL-1275 was stale: there is one.

Implementation notes (design-gate r2, non-blocking): `PanelFullscreenOverlay` computes no `controlFilterOps` today —
compute `buildViewerControlFilterOps(controls, controlValues)` there. `SET LOCAL` needs a transaction: send
`BEGIN; SET LOCAL …; UPDATE …; COMMIT;` in one `psql` call. The fan-out also fires on failed runs; the delayed retry
runs at most once. Pre-existing L3 + client defect (a lone `label` fieldMapping is picked as the metric field) is a
follow-up against L3, not fixed here.
