## Evaluation Report — Cycle 2

### Phase 1: Spec Review — PASS
Issues: none.

Cycle 1's critical gap (durable persistence) is now closed. Verified independently:
- `backend/src/main/resources/db/migration/V43__panel_aggregation_column.sql` adds `panels.aggregation JSONB` (nullable), applied cleanly on a fresh embedded-Postgres test run (Flyway log shows `Migrating schema "public" to version "43 - panel aggregation column"`) and confirmed already applied on the live dev DB (`flyway_schema_history` row for v43).
- `PanelRowMapper.metricConfig`/`chartConfig` read `row.aggregation`; `domainToRow` writes it for the metric/chart branches (`PanelRowMapper.scala:66-100`).
- `PanelRepository.replace`'s persisted-column whitelist now includes `r.aggregation`/`updated.aggregation` (`PanelRepository.scala:203-207`) — this was the exact point of data loss cycle 1 identified; now fixed.
- `PanelRepository.insert` uses `domainToRow` unconditionally via the table's `*` projection, so `apply_proposal`-created panels also persist `aggregation` durably (not just the in-memory response object as before).
- design.md Decision 5 and tasks.md section 1/7 now explicitly document the DB/repository wiring (cycle-1 CR #3, closed).
- New backend tests (`ApiRoutesSpec.scala`) exercise a real repository round trip (PATCH → fresh `GET /api/dashboards/:id/panels`, not the PATCH response) for metric set, chart `groupBy` set, and metric explicit-null clear (cycle-1 CR #2, closed).

All ticket ACs are addressed; no scope creep; no regressions in existing coverage (see Phase 2 for full test run).

### Phase 2: Code Review — PASS
Issues: none blocking.

- Ran `sbt test` (full suite, embedded Postgres, real Flyway migrations through v43): **949/949 passed**, including the 3 new HEL-292 repository-round-trip tests.
- Ran `npm test` (frontend): **748/748 passed** across 63 suites.
- Ran `npm run lint` (zero-warnings ESLint): clean.
- Ran `npm run check:scala-quality`: clean (only pre-existing soft file-size warnings; `PanelRepository.scala` was already over the 250-line soft budget before this ticket — 276→279 lines is a marginal, unavoidable increase from one new field, not a new violation).
- `panelThunks.ts`'s 4-arg/5-arg ternary (cycle-1 non-blocking suggestion) has been simplified to a single unconditional call, as suggested.
- `usePanelData.test.ts` now includes a 15-row metric fixture exceeding the pre-existing page-size default (cycle-1 non-blocking suggestion), actually exercising the `Number.MAX_SAFE_INTEGER` override.
- DRY/readability/modularity/type-safety/error-handling: consistent with cycle-1's clean assessment; new migration/mapper/repository code follows existing `field_mapping` conventions exactly.

### Phase 3: UI Review — FAIL
Setup: `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` both passed (backend :8372, frontend :5465 healthy; backend already running current code — confirmed `flyway_schema_history` shows v43 applied).

**AC verification (positive) — confirmed independently, fresh evidence:**
- Metric panel ("Jan 2026 Profit", `Profit` DataType, aggregation `{value: profit, agg: avg}`): full page reload → view-mode value slot shows `604020` (the correct average of 0/100/20000/1000000/2000000), not `0`/`rows[0]`. Reopening Edit shows Field=`profit`, Function=`Average` — the saved spec is not reset. **This closes cycle-1's core reproduction and CR #4.**
- Chart panel ("Helio is profitable?"): saved chart aggregation spec (`groupBy=month, agg=avg, yField=profit`) survives a fresh page reload and reopen of the editor (Group by/Value field/Function all show the saved values, not reset).
- No console errors were raised during any of the above flows.

**New issues found this cycle (both introduced by/unique to this ticket's cycle-1 code, still present after cycle-2's fix, verified live and root-caused in source — not simulated):**

1. **Spurious "Unsaved changes" on every open of a panel with a saved aggregation spec (metric AND chart), even when nothing has been touched.** Reproduced on three separate panels: the existing "Jan 2026 Profit" metric, the existing "Helio is profitable?" chart, and a freshly created "Control Metric No Agg" test metric panel (created and saved fresh in this session, ruling out any stale/prior-session artifact). In all three cases, clicking "Edit panel" immediately shows the "Unsaved changes" badge with zero user interaction, and pressing Escape or Cancel triggers a "You have unsaved changes. Discard them?" confirmation for a panel the user never touched.

   **Root cause (confirmed via `psql`):** PostgreSQL's `jsonb` column type does not preserve key insertion order — it reorders object keys on every round trip (verified: `SELECT '{"value":"profit","agg":"avg"}'::jsonb` returns `{"agg": "avg", "value": "profit"}`; live DB rows confirm `aggregation = {"agg": "avg", "value": "profit"}` for the metric panel and `{"agg": "avg", "yField": "profit", "groupBy": "month"}` for the chart panel). `BindingEditor.tsx`'s dirty check (`frontend/src/features/panels/ui/editors/BindingEditor.tsx:118-119`) compares `JSON.stringify(currentAggregation) !== JSON.stringify(initialAggregation)`. `initialAggregation` is the raw, Postgres-reordered object read straight off `panel.config.aggregation`. `currentAggregation`, however, is **freshly reconstructed** every render via a literal (`{ value: aggField, agg: aggFn }` for metric, `line 109`; `{ groupBy: aggField, agg: aggFn, yField: aggYField }` for chart, `line 113`) — a fixed key order that essentially never matches Postgres's returned order. The two objects are semantically identical but stringify to different key orders, so the comparison is always true for any panel with a saved aggregation spec, regardless of whether the user changed anything. This is a real, code-traceable bug — not a rendering glitch — confirmed by the control-group test: the identically-structured `fieldMapping` dirty check (`BindingEditor.tsx:124`) does **not** exhibit this bug, because `fieldMapping`'s local state is seeded as a direct pass-through of the already-reordered initial object (never reconstructed via a fresh literal), so both sides of that comparison share the same key order.

   **Fix direction:** compare the aggregation spec's individual fields directly (`currentAggregation?.value === initialAggregation?.value && currentAggregation?.agg === initialAggregation?.agg`, etc. — mirroring how `selectedTypeId`/`refreshInterval` are already compared by value, not by `JSON.stringify`), or normalize key order before stringifying both sides.

   This is a direct regression against "errors handled at boundaries; no silent failures" / "no console errors" checks — no exception is thrown, but the UI presents an incorrect, confusing dirty state on a clean panel, which is exactly the class of issue Phase 3 exists to catch. Ironically, this ships alongside a Quick Notes panel already complaining that "'Unsaved changes' and 'Save now' are very tedious and frustrating" — this change makes that worse for every aggregation-bound panel.

2. **Metric panel with an aggregation spec but no field mapping at all shows "No data" instead of the aggregate.** Design.md Decision 3 states the aggregation spec is "independent of `fieldMapping.value`," and the BindingEditor UI does not require any field-mapping slot to be set before allowing an aggregation spec to be configured and saved (all three Field mapping selects — Value/Label/Unit — can legitimately be left at "— None —"). Reproduced live: created a fresh metric panel bound to `Profit`, left Field mapping fully unset, set only Aggregation Field=`profit`/Function=`Average`, saved successfully (200 response, migration confirms persistence), but the panel's view-mode value slot shows `"--"` / "No data" both immediately after save and after a full page reload — the aggregate never renders.

   **Root cause:** `usePanelData.ts:147-148` — the `data` memo bails out early with `if (rows.length === 0 || !fieldMappingKey) return null;` **before** it reaches the aggregation-override logic at line 156-159. When `fieldMapping` is empty (`{}`), `fieldMappingKey` is `null` (falsy), so `data` returns `null` unconditionally, and the metric aggregate override is never reached regardless of whether `metricAggregation` is set.

   **Fix direction:** move the `metricAggregation` check ahead of (or independent of) the `!fieldMappingKey` guard, e.g. `if (rows.length === 0 || (!fieldMappingKey && !metricAggregation)) return null;`, and build `mapped` starting from an empty object when `fieldMapping` is absent but an aggregation spec is present.

Because the happy path (aggregation-with-field-mapping) does work correctly, breakpoint/keyboard checks were completed opportunistically but not exhaustively pursued past these two findings — the same class of bug (untested config combinations) should be closed before further UI polish review is productive.

### Overall: FAIL

### Change Requests
1. Fix the aggregation dirty-tracking comparison in `frontend/src/features/panels/ui/editors/BindingEditor.tsx` (lines 107-119 for metric, mirrored for chart) to compare structurally/by-field rather than via `JSON.stringify` on objects whose key order is not guaranteed stable across a Postgres JSONB round trip. Add a regression test that seeds `initialAggregation`/`panel.config.aggregation` with a **different key order** than the component's own literal construction order (mirroring what Postgres actually returns, e.g. `{"agg": "avg", "value": "profit"}`) and asserts `aggregationDirty`/the "Unsaved changes" badge is `false` on mount when nothing has changed. This exact gap — tests using JS object fixtures that never reflect the real DB-serialized shape — is the same category of gap flagged in cycle 1 (CR #2), just recurring in a new spot; extend the "PATCH → fresh GET" testing discipline to cover the frontend's dirty-check consuming that response, not just backend persistence.
2. Fix `frontend/src/features/panels/hooks/usePanelData.ts:147-148` so the metric aggregation override is reachable even when `fieldMapping` is empty/absent (the early-return guard should not gate the aggregation path). Add a `usePanelData.test.ts` case with `fieldMapping = {}` and a `metricAggregation` spec set, asserting `data.value` reflects the aggregate rather than `data` being `null`.
3. Re-verify both fixes live (reload + reopen editor, for a metric panel with aggregation-only config and no field mapping) before the next cycle's evaluation.

### Non-blocking Suggestions
- Consider adding a short code comment at the `currentAggregation` `useMemo` in `BindingEditor.tsx` noting that key order must not be relied upon for equality checks, to prevent a future regression once CR #1 is fixed.
