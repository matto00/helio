## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `2c49bdba8ffe0df5df65b2c951c0b9bb73173c2b` (worktree = main; change dir untracked).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/metric-delta-sparkline-ui/HEL-1275`.

### What I verified (with evidence)

**Claims that hold**
- L3 wire shape (design Context) matches `OutputHistoryProtocol.scala`: `compare`, `current`/`baseline` `{capturedAt,rowCount,value}`, `delta`, `pct`, `availableFrom`, `sparkline` oldest-first (`points.reverse`), `points` newest-first; authenticated adds `outputId` plus per-point `runId`/`triggerSource`; nullable fields are explicit JSON null. `value` comes from `summary.metric.value` with `v == 1` (`OutputHistoryService.headline`).
- `current` = `recent.head`. With no `since`, `points[0]` is the head (`OutputHistoryService.forOutput`). previous_run = `recent.lift(1)`. A window is measured from the latest point, and `availableFrom = earliest + w`.
- The D2 port target is accurate: `OutputSummaryReducer.metric` uses exactly one string fieldMapping value if there is one, otherwise `fieldMapping.value` ?? `aggregation.value`, with agg = `aggregation.agg` or null. `summary.metric` is written only for kind metric.
- The client headline today is `Object.values(cfg.fieldMapping)[0]` over the ≤200 loaded rows (`PanelContent.tsx:292-310`). `MetricRenderer.tsx` has the unused `data.trend` slot. The `--up/--down/--flat` classes use `--app-success`, `--app-error` and `--app-text-muted` (`PanelContent.css:244-253`).
- `PanelContent` has exactly four JSX call sites: `PanelCard.tsx:315`, `PanelFullscreenOverlay.tsx:204`, `PanelDetailModal.tsx:488` and `PublicDashboardViewerPage.tsx:110`.
- The provenance cache pattern is real (`provenanceCache.ts`): module-level, `output:`/`public:` keys, shared in-flight promise, generation counter. `ProvenanceTrigger.tsx:106-107` invalidates through `subscribeToPipelineTerminal`, and the public path does not subscribe.
- `PublicOutputMeta` carries `config`, so the D2 guard can run on the public path. Both history routes exist (`OutputRoutes.scala:89`, `PublicDashboardRoutes.scala:412`).
- D7 environment: V115 has `ENABLE` + `FORCE ROW LEVEL SECURITY` (lines 38-39). The CI e2e job's postgres service is created with `POSTGRES_USER: helio`, which makes it the image superuser, so FORCE RLS is bypassed. `DATABASE_URL`/`DB_USER`/`DB_PASSWORD` are job-level `env` (`ci.yml:340-343`). No change to `ci.yml` or `playwright.config.ts` is planned, no migration is planned, and seeding comes after `about:blank` (precedent at `hel1260-orphan-owner-repair.spec.ts:59`).
- D7 run ordering is safe for a synchronous seed. `POST /api/pipelines/:id/run` returns only after `followUp` completes (`PipelineRunService.scala` ~1185), and `onUnblockedRunSuccess` waits for `materializedWrites` (the history insert shares the node snapshot transaction, ~1452) before the for-comprehension finishes. So the history row exists when the 200 returns.
- Arithmetic: (1204−1075)/1075×100 = 12.000, which formats as "12%".

**D3 interpretation (the question the orchestrator asked me to judge).** The design's reading is sound: under a viewer filter the headline shows the filtered rows and the comparison is hidden. The other reading keeps the server's unfiltered headline even under a filter. That reading has two problems:
- It makes hiding the delta pointless, because an unfiltered headline next to an unfiltered comparison is self-consistent.
- It would stop viewer controls (HEL-1190) from having any effect on metric panels, which is a regression.

The owner's tooltip text ("comparison reflects unfiltered data") only makes sense if the displayed number is filtered. Counting an applied cross-filter as a filter follows from the same logic. I am not escalating this.

**Claims that do not hold, or are under-specified.** These became the change requests below.
- `buildViewerControlFilterOps` (`viewerControlValues.ts:141-171`) drops values that are empty or unparsable. A "defined value" is therefore not the same as an applied filter.
- `PanelContent` has no `dashboardId`/`token`/variant prop (`PanelContent.tsx:50-130`). The design never says how its metric branch picks the public key or fetcher.
- `ProvenanceTrigger` has six call sites (PanelCard:811 in the card header, outside `PanelCardBody` where `useViewerControls` runs; PanelFullscreenOverlay:178; PanelDetailModal:114 and 433; MobilePanelStack:171; PublicDashboardViewerPage:92). Its props (`ProvenanceTrigger.tsx:34-47`) carry no kind, config, format or filter state. D6's "only when D2+D3 would show a delta" has no plumbing behind it.
- `PATCH /api/outputs/:id` is a shallow merge (`OutputService.mergeConfig`, line 466). Omitting `compare` already preserves it today, so the stated "buildOutputConfig drops compare" risk is not a real loss on update. The real hazard runs the other way: "None" must send a literal `null`, because an `undefined` is dropped by JSON and silently keeps the old value.
- `buildAggregateTailConfigs` is reachable only while creating (`canAddTailWithAggregate` requires `isCreate`, `OutputEditorSheet.tsx` ~364). That means "the loaded config's compare" for the tail is always absent, and a picker choice would be silently lost there.
- D2 guards only the head point. Earlier `points` (sparkline) and the baseline can carry a different `summary.metric` field/agg after a config edit, and the server resolver (`resolveBaseline`) does not filter by metric identity.

### Verdict: REFUTE

### Change Requests

1. **D3 "filter active" must mean an applied filter, not a defined value.** The design treats "any `useViewerControls(...).values` entry defined" as active. `buildViewerControlFilterOps` skips `""` text/dropdown values and unparsable range values, so in those cases the rows are not filtered. Under the design's rule the panel would still hide the delta and fall back to the ≤200-row headline. Define the viewer half as `buildViewerControlFilterOps(controls, values).length > 0`, which is the same ops the row fetch actually sends; every call site already computes `controlFilterOps`. Add an RTL case: an empty-string dropdown value still shows the delta.

2. **Specify how `PanelContent` gets the public history source.** Name the new prop. One option is `historySource?: { variant: "public"; dashboardId; token }`, set only by `PublicDashboardViewerPage`, with the default keyed `output:<outputId>`. State that the public page passes it, and that the public key never subscribes to the run fan-out.

3. **Specify the D6 provenance plumbing.** State how `ProvenanceTrigger`/`ProvenanceContent` learn the Output kind, config (for the D2 guard and `format`) and filter state at all six call sites. One option: the panel body computes the `selectMetricHistoryView` result once and publishes it per panel, for example in the history cache entry keyed by panel. Another: pass `viewerFilterActive` and the output into each trigger. Name the files touched. The PanelCard header trigger sits outside `PanelCardBody`, where the viewer-control state is read today. Task 2.5 / 4.4 must cover the filtered case: no "Compared with" row while a filter is active.

4. **Do not let other-config points into the sparkline or delta.** D2 rejects a head that was computed under a different field/agg, but then draws the sparkline from all `points` and shows the server's baseline delta regardless. After an edit from `sum` to `avg` and a re-run, the panel would plot old sums beside new averages, and could show "▲ 900% vs 7d" comparing an avg against a week-old sum.
   - Required: drop sparkline points whose `points[i].summary.metric.{field,agg}` differ from the current resolution. Both arrays come from the same points, so this needs no extra request.
   - Required: hide the delta when the baseline point appears in `points` (match on `capturedAt`) with a different metric.
   - Required: record the remaining case (a baseline older than the returned points) as an explicit known limitation, with a follow-up against L3's resolver, rather than leaving it silent.
   - Add unit tests for both guards.

5. **Correct D5's premise and close the two real gaps.**
   - (a) Rewrite the rationale to match the server: PATCH is a shallow merge (`OutputService.mergeConfig`), so omitting `compare` keeps it. Pass-through is harmless, but "None" must emit a literal `compare: null`. Add a test asserting the payload contains `compare: null`; asserting only that the key is absent would pass while being wrong.
   - (b) The aggregate-tail path is create-only, so the metric `outputConfig` from `buildAggregateTailConfigs` must carry the picker value, not "the loaded config's compare". Add `compare` to that function's params and test it.

6. **D7 must prove the exit criterion through the picker.** The exit criterion is "1,204 ▲ 12% vs 7d with a sparkline after only choosing `compare`". Seeding `compare: "7d"` through the API skips the one client/server seam this ticket adds: picker → `buildOutputConfig` → PATCH → `OutputCompare.validateConfig` → history `compare`. Create the Output without `compare`, run twice and backdate as planned, then choose "7 days" in the Output editor UI and save. Then assert the panel. This works because `compare` is resolved at read time from the current config.

### Non-blocking notes
- **SSE ordering.** `RunStatusEvent("succeeded")` is published (`PipelineRunService.scala:1395`) before the snapshot and history writes (~1405-1452), and `updateRunTerminal` is an eagerly-started `val` that runs alongside them. A history refetch triggered by the fan-out can therefore read the pre-run head. Rows already have the same race (`usePanelRunRefresh`). Once the headline moves to the server value, though, a stale history read leaves a visibly stale headline next to fresh rows. Record this in Risks. A cheap mitigation: if the refetched `current.capturedAt` did not advance, retry once after a short delay.
- **D2 rationale wording.** "Covers the existing frontend/server field-choice divergence" overstates it. The guard compares the server summary against the server rule applied to the current config, not against the client's choice. The outcome (prefer the server value) is still an improvement; the wording should say so honestly.
- **Sparkline stroke.** DESIGN.md scopes `--app-accent-text` to accent used as text (HEL-1048 `text-only-token`); `--app-accent` is the decoration token. Either use `--app-accent` and confirm 3:1 non-text contrast in both themes, or justify the choice in the design. There is no stroke-width token, so "at token stroke width" is not grounded; name the literal width and the reason.
- **Local e2e environment.** `playwright.config.ts` does not load `backend/.env`, and the local `.env` has no `DB_USER`. Say how task 3.1 / 4.5 provide `DATABASE_URL`/`DB_USER`/`DB_PASSWORD` locally, or the helper's "fail loudly" will fire on the executor's first run. Alternatively, run the UPDATE with `SET LOCAL app.current_user_id = '<test user id>'` so it works for a non-superuser as well.
- **Filtered headline row limit.** Under a filter the headline still uses ≤200 rows. Open the follow-up ticket now and link it from the PR; don't just mention it.
- **Delta colour.** Up = `--app-success` assumes up is good, which reads wrong for cost or error metrics. That is pre-existing spec behaviour and outside L5's scope; worth a follow-up idea only.
- **Available-from note under a config mismatch.** The spec does not say whether the note is suppressed when the D2 guard fails. Pin it (suppress) in the spec scenario.
