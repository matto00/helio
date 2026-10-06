## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `2c49bdba8ffe0df5df65b2c951c0b9bb73173c2b`. The worktree equals main and the change dir is untracked.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/metric-delta-sparkline-ui/HEL-1275`.
Artifacts read: ticket.md, proposal.md, design.md, specs/metric-history-delta-ui/spec.md, tasks.md, workflow-state.md, skeptic-design-1.md.

### Round-1 change requests — each verified against source

**CR1 (applied filter, not a defined value): addressed.**
- D3 now defines the viewer half as `buildViewerControlFilterOps(controls, values).length > 0`.
- `viewerControlValues.ts:141-176` skips `""` text/dropdown values and unparsable range/date values, so this definition is exactly "the ops the row fetch sends".
- The cited sites exist and compute those ops: `PanelCard.tsx` (PanelCardBody `controlFilterOps` useMemo, ~184), `PanelDetailModal.tsx:177`, `PublicDashboardViewerPage.tsx:68`.
- The spec has the scenario "Empty control value does not hide the delta", and task 4.2 covers it with a mutation check.
- Ground truth for "the headline = filtered rows":
  - The metric branch reads `filteredRawRows`, derived from `rawRows` (`PanelContent.tsx` metric branch).
  - `rawRows` comes from `paginationState[panel.id].rows` (`usePanelData.ts:213-230`).
  - That shared entry is re-dispatched with the control ops by `usePanelSortFilter` (lines 131-143 and 250-256) on the card path, and explicitly on the modal and public paths.
  - So under an applied control, the loaded rows really are filtered. The round-1 reading still holds.
- Cross-filter half: `mode === "server"` is returned only when a cross-filter is active, comes from another panel, and narrows this panel (`useCrossFilterServerOps`). `isCrossFiltered` is the existing client-fallback signal (`PanelContent.tsx`). Both are sound.

**CR2 (public history source): addressed.** D4 names `historySource?: { variant: "public"; dashboardId; token }`, set only by `PublicDashboardViewerPage`. D1 states that public keys never subscribe to the fan-out. Task 1.2 tests "public key never subscribes".

**CR3 (provenance plumbing): addressed.**
- All six `ProvenanceTrigger` call sites already pass `panelId` and `variant` (verified: PanelCard:811, PanelFullscreenOverlay:178, PanelDetailModal:114 and 433, MobilePanelStack:171, PublicDashboardViewerPage:92; props at `ProvenanceTrigger.tsx:34-47`). A store keyed `<variant>:<panelId>` therefore needs no new call-site props.
- Every trigger has a live publisher. PanelCard's header trigger and MobilePanelStack's trigger are served by `PanelCardBody` → `PanelContent` (PanelCard.tsx:315), which is shared by the desktop grid and the mobile stack. The fullscreen, detail-modal and public triggers sit beside their own `PanelContent`.
- Multi-publisher semantics are sound for these reasons:
  - Every publisher of one `<variant>:<panelId>` reads the same URL-held control values (`useViewerControls` is keyed by panel id).
  - Every publisher reads the same history cache key.
  - The fullscreen overlay receives the same `crossFilterMode` from PanelCard. The modal computes the same mode via the same `useCrossFilterServerOps`.
  - So concurrent publishers compute the same view, and "latest live publisher, removed on unmount" has no observable disagreement.
- The filtered case publishes null, which is task 2.5 and the 4.4 "absent under an applied filter" test. The files touched are named.

**CR4 (other-config points): addressed.**
- D2 filters sparkline entries by the same-`capturedAt` point's `summary.metric.{field,agg}`. It hides the delta when the baseline appears in `points` with a non-matching metric, and suppresses the note on a head mismatch.
- The spec has the scenario "Points from an earlier config are excluded" and pins note suppression in "Config edited…".
- The known limitation is recorded (L3's `resolveBaseline`, `OutputHistoryService.scala:76-92`, does not filter by identity).
- Both arrays come from the same points (`OutputHistoryProtocol.scala` `sparkline(points) = points.reverse…`), and public points carry `summary` too (`PublicOutputHistoryPoint`), so the guard works on both paths.

**CR5 (picker payload / aggregate tail): addressed, and the premise is now correct.**
- `OutputService.mergeConfig` (line 466) is a shallow merge for non-sub-object keys. `OutputCompare.fromConfig` treats absent and `JsNull` alike as "no comparison", and `validateConfig` accepts `null`. So "metric always emits `compare` (literal null for None); other kinds omit it" is correct.
- `buildAggregateTailConfigs` (buildOutputConfig.ts:151) is called only behind `isCreate` (OutputEditorSheet.tsx:366-370). D7 adds the picker param.
- Task 4.3 asserts "key present and null" and the aggregate-tail value.

**CR6 (exit criterion through the picker): addressed.** D8 creates the Output without `compare` and chooses "7 days" in the editor UI, matching C5. This works because `forOutput` resolves `compare` from the current config at read time (`OutputHistoryService.scala:49-58`).

### Driver focus items — verified
- **D8 RLS GUC:** `helio_can_access_pipeline` (V39, `SECURITY DEFINER`) reads `current_setting('app.current_user_id', true)` and returns FALSE when it is empty. V115 has ENABLE + FORCE RLS and a `FOR UPDATE USING (helio_can_access_pipeline(pipeline_id))` policy, so `SET LOCAL app.current_user_id` to the owning test user lets a non-superuser UPDATE pass.
- **D8 environment:** the CI e2e env supplies `DATABASE_URL`/`DB_USER`/`DB_PASSWORD` (`ci.yml:340-343`, image user `helio`), and the worktree has `backend/.env` with `DATABASE_URL`. No ci.yml, playwright.config.ts or migration change is planned. Seeding comes after `about:blank`.
- **D7 builders:** checked as above. The 4.3 tests target the real failure direction (null vs omitted).
- **D2 port:** the design's rule matches `OutputSummaryReducer.metric` (lines 87-103) exactly.
- **New false claims:** none found. The cited line numbers and files (`ProvenanceTrigger.tsx:106`, `ProvenancePopover.tsx`, `LastRunRow` in `ProvenanceContent.tsx:13`, the compact container query `PanelContent.css:256-258`, the `integer` MetricFormat giving "1,204", the `--app-accent` vs `--app-accent-text` rule in DESIGN.md:900) all check out.

### Verdict: CONFIRM

### Non-blocking notes
- **D3 wording, fullscreen overlay.** `PanelFullscreenOverlay` does not compute `controlFilterOps` today; it has only `controls`/`controlValues` (lines 128-136). Its rows are already filtered, because the card's `PanelCardBody` dispatch fills the shared pagination entry. The executor should compute `buildViewerControlFilterOps(controls, controlValues)` in the overlay (or pass it from PanelCard) rather than look for an existing "equivalent".
- **Pre-existing L3 + client headline defect worth a follow-up ticket (not L5's to fix).**
  - The server rule (ported exactly in D2) picks the single fieldMapping string even when it is a `label`/`unit` mapping. Example: the editor emits `fieldMapping: {label: "region"}` together with `aggregation: {value: "amount", agg: "sum"}` (`buildOutputConfig.ts:86-97`). The server then stores `field: "region"`, and `computeAggregate` "sum" over non-numeric values yields `0.0`, not null (`OutputSummaryReducer.scala:30`).
  - The current client headline (`Object.values(fieldMapping)[0]`) has the same bug, so L5 does not regress anything.
  - However, the D2 guard will "match", and the panel will confidently show a server 0 with a delta. File it against HEL-918/L3.
- **Follow-ups.** D2/Risks say the two follow-ups (baseline older than the returned points; filtered headline limited to ≤200 rows) are "noted in the PR". Prefer opening the tickets and linking them, as round 1 suggested.
- **`SET LOCAL` needs a transaction.** Use an explicit `BEGIN; SET LOCAL …; UPDATE …; COMMIT;` (or a single multi-statement `-c`, which runs as one implicit transaction). The affected-row-count assertion will catch a misfire either way.
- **`psql` on CI.** No existing e2e spec shells out to `psql`. ubuntu-latest ships a client, but the first CI run is the real check. Keep the "fail loudly" behaviour.
- **Fan-out retry.** `subscribeToPipelineTerminal` also fires on failed runs, which never advance `current.capturedAt`. The single 1.5 s retry is bounded, so this is harmless, but don't let the retry loop.
