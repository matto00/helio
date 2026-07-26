## Context

`ChartPanel.tsx` gates the HEL-292 `chartAggregate` render path to `chartType === "bar" || "line"`. Pie
and scatter silently fall back to per-row rendering. Backend-side, `aggregation` is stored as an opaque
`Option[JsObject]` on `ChartPanelConfig` with zero shape/cross-field validation — `ChartPanel.validateConfig`
is a hardcoded `Right(())` (the trait doc literally flags this as deferred: "does NOT yet promote this to a
hard patch-time gate"). Nothing in `schemas/panel.schema.json` or `helio-mcp/src/tools/write.ts`'s
`create_panel` description mentions `aggregation` for chart panels at all today.

## Goals / Non-Goals

**Goals:**
- Pie honors `aggregation` exactly like bar/line (grouped categories → `{name, value}` slices).
- Scatter + `aggregation` is rejected with a clear 400 at every write path that can create or mutate a
  chart panel's `appearance`/`config` — single create, batch create, replace-contents, apply-proposal,
  single update, batch update, AND dashboard-snapshot import — never silently accepted.
- The restriction is discoverable from `schemas/panel.schema.json` and `create_panel`'s description
  without reading `ChartPanel.tsx`.
- The config UI hides the Aggregation section for a scatter-typed chart, so a human editor never even
  reaches the 400.

**Non-Goals:**
- Reworking scatter to have *some* aggregate semantic (e.g., one averaged point per group) — out of scope;
  scatter's raw-point rendering is unchanged.
- Transactional atomicity across `PanelPatchApplier`'s sequential title/appearance/config writes — the
  scatter/aggregation check runs as a pre-write gate (before any of the three writes), so this doesn't
  need to change existing write-ordering.
- Touching `panel-capability-introspection` / `PanelBindingSpec` — verified (read both) they document
  `fieldMapping` slot eligibility only, never chart-type-specific aggregation semantics. No divergence
  exists to fix.
- **General import validation.** Round 3 of this design gate found that `POST /api/dashboards/import`
  (`DashboardServiceValidation.validatePanelEntries`) validates a panel entry's `config` shape only — it
  never enforces the `chartType` enum (unlike every other write path) or any other cross-field rule. This
  ticket adds exactly ONE cross-field check to that function (D2's 5th enforcement site, scoped to the
  scatter+aggregation rule this ticket owns) — it does **not** bring import's validation up to parity with
  the rest of the write surface for anything else (chartType enum validity, or any other future
  cross-field rule stays unenforced on import after this ticket ships). That broader gap is real and is
  tracked as a separate spinoff ticket (filed under HEL-344, referencing `skeptic-design-3.md`) — do not
  read the presence of this one check as "import is now validated."

## Decisions

**D1 — Pie aggregate data shape.** `buildAggregateDataOption(aggregate, chartType)` in `ChartPanel.tsx`
branches on `chartType === "pie"`: emit `{ series: [{ type: "pie", data: categories.map((name, i) => ({
name, value: values[i] })) }] }` (no `xAxis`) instead of the bar/line `{xAxis, series:[{data: values}]}`
shape. `useAggregate`'s guard becomes `chartType === "bar" || chartType === "line" || chartType ===
"pie"`. `applyChartTypeOptions`'s existing `applyPie` (donut/percent-label) operates on `series[0]`
generically and needs no change — it already expects `{name,value}` data.

**D2 — One rule (predicate), FIVE enforcement sites — direct-create, PATCH, batch-PATCH, the
ProposalPanel pre-pass, and snapshot import.** The rule ("scatter + present aggregation is invalid") lives as a pure predicate
in `ChartPanel`'s companion object — `ChartPanel.rejectsAggregation(chartType: Option[String],
aggregationPresent: Boolean): Option[String]` — returning the shared error message or `None`.
`ChartPanel.validateConfig` calls it with `this.appearance`/`this.config`, finishing the trait's
documented "not yet a hard gate" TODO for this one case (other subtypes are unaffected, still
`Right(())`).
  - **Direct create** (`PanelService.buildForCreate`): after `buildNewPanel` returns a fully-resolved
    `Panel` (typed `ChartPanelConfig.aggregation: Option[JsObject]` + typed `PanelAppearance`), call
    `panel.validateConfig`; `Left` → 400 before `rejectCompanionBinding`/insert. Covers `POST /api/panels`,
    `POST /api/panels/batch`, and `create_bound_panel` (`BoundPanelService.createPanel` passes
    `request.panel.appearance` straight through to `buildForCreate`, confirmed by reading it — `appearance`
    is NOT dropped on that path). **Does NOT cover apply-proposal or replace-contents** — see the
    dedicated bullet below; this was wrong in round 1 of this design and is corrected here.
  - **ProposalPanel paths (apply-proposal, replace-contents)** — **the actual fix for these two paths**,
    not `buildForCreate`. `ProposalPanelSupport.buildCreateRequest` never sets `appearance` on the
    `CreatePanelRequest` it builds (only `dashboardId`/`title`/`type`/`config`); a proposal's `chartType` is
    applied later via a *separate* `DashboardProposalService.applyAppearance` PATCH whose failure is
    explicitly swallowed (`case Left(_) => acc :+ created // appearance is cosmetic`). So validating only at
    `buildForCreate` would let a proposal's `chartType: "scatter"` + `aggregation` combination create a
    panel successfully with a *different* (default) chart type and no error — silent-ignoring relocated,
    not fixed. Instead, extend `ProposalPanelSupport.validatePanel` (already the function that validates a
    chart panel's `chartType` enum up front, before any write) to also reject a scatter/aggregation
    conflict — checked against the **actually-resolved config**, not the pre-merge flat `panel.aggregation`
    field alone. Round 2 of this design gate caught that checking only `panel.aggregation.isDefined` has a
    live bypass: `ProposalPanelSupport.buildCreateRequest`'s existing HEL-316 `mergeConfig` lets a caller
    set the same top-level `"aggregation"` key via the generic `panel.config` passthrough, which
    `ChartPanelConfig.decodeCreate` reads identically to the flat field — a proposal supplying
    `chartType: "scatter"` (flat) + `config: {"aggregation": {...}}` (passthrough, not the flat field) would
    sail through a flat-field-only check (verified exploitable — `DashboardApplyProposalConfigSpec.scala`
    already exercises this exact passthrough mechanism for `chartOptions`). The fix: run the check against
    `ProposalPanelSupport.buildCreateRequest(dashboardId, panel).config`'s resolved `aggregation` key (the
    same JSON `ChartPanelConfig.decodeCreate` will actually read), not `panel.aggregation` directly — a
    small `mergedAggregationPresent(panel): Boolean` helper that calls `buildCreateRequest` (a pure,
    side-effect-free function already used for construction) and peeks its `config` JsValue for a JsObject
    `"aggregation"` key, mirroring `ChartPanelConfig.decodeInternal`'s own `Some(o: JsObject) => Some(o)`
    extraction rule. Reject when `panel.type == "chart" && panel.chartType.contains("scatter") &&
    mergedAggregationPresent(panel)` (the `chartType` side has no equivalent passthrough risk — chart type
    is never a `ChartPanelConfig` key, only a proposal's flat field or `appearance.chart.chartType`, and
    proposals never set `appearance` at create time at all). Both `DashboardProposalService.validateStructure`
    and `DashboardContentsService.validatePanels` call `ProposalPanelSupport.validatePanel` per-panel in
    their existing zero-write pre-pass (confirmed both call sites run strictly before any write) — one edit
    closes apply-proposal AND replace-contents together, with the same "validate every item before any
    write" guarantee those pre-passes already provide for `chartType` enum validity. **General principle
    this reinforces** (root cause of both the round-1 and round-2 findings): always validate the
    actually-resolved value a decoder will read, never a pre-merge intermediate representation that a
    passthrough/override mechanism can diverge from.
  - **Update** (`PanelService.update`, single): `resolvePatch` already fully merges an incoming
    `appearance` patch over the stored one (HEL-362 partial-merge), but `configPatch` stays a raw
    `JsValue` (applied later, per-subtype, inside `PanelPatchApplier`). Rather than decode+`copy()` a
    hypothetical merged `ChartPanel` (which risks a `deserializationError` thrown synchronously outside
    the `Future` for a malformed patch the *existing* downstream decode would otherwise 400 cleanly),
    peek the raw JSON the same tolerant way `chartTypeFromAppearanceJson`/`dataTypeIdFromConfigPatch`
    already do in `PanelServiceHelpers`: `aggregationPresenceFromConfigPatch(json): Option[Boolean]`
    (`Some(true)` = sets a JsObject, `Some(false)` = explicit `null`, `None` = field absent → unchanged).
    The helper is `validateScatterAggregationConflict(existing: Panel, spec: ResolvedPanelPatch): Either[String,
    Unit]` and its FIRST step is a type-narrowing match — `existing match { case cp: ChartPanel => ...;
    case _ => Right(()) }` — because `PanelAppearance.chart` is a field shared by every panel kind (a
    `TablePanel` could structurally carry an incidental, never-rendered `appearance.chart` value), so the
    check must be a no-op for any non-`ChartPanel`. Inside the `ChartPanel` branch, compute
    `effectiveChartType = spec.appearance.orElse(Some(cp.appearance)).flatMap(_.chart).flatMap(_.chartType)`
    and `effectiveAggregationPresent = spec.configPatch.flatMap(aggregationPresenceFromConfigPatch)
    .getOrElse(cp.config.aggregation.isDefined)`, then call the SAME `ChartPanel.rejectsAggregation`
    predicate. Runs synchronously in `PanelService.update` before `patchApplier.apply` — before any of the
    three writes, so no partial write is possible. Also catches the edge case the create-time-only check
    would miss: an appearance-only PATCH that flips an existing bar-with-aggregation panel to scatter.
  - **Batch update** (`PanelService.batchUpdate`): identical raw-peek treatment (same type-narrowing guard
    per pair), added as `validateBatchAggregationConflict(items.zip(panels))` alongside the existing
    `validateBatchTypeMatch`/`validateBatchChartTypes` pre-write checks in the same `for`-comprehension.
  - **Dashboard-snapshot import** (`POST /api/dashboards/import`) — **the 5th site, added per round 3's
    finding.** `DashboardService.importSnapshot` → `DashboardServiceValidation.validatePanelEntries` →
    `DashboardSnapshotRepository.importSnapshot` is a completely separate call graph from `PanelService`/
    `ProposalPanelSupport` — `importSnapshot` builds `ChartPanel` domain objects directly from
    client-supplied `entry.appearance`/`entry.config`, and `validatePanelEntries` today only calls
    `PanelConfigCodec.decodeCreateConfig(entry.type, Some(entry.config))` for a shape check, never any
    cross-field rule. This is actually the SIMPLEST of the five sites to fix correctly, because
    `validatePanelEntries` already has both values in their fully-resolved, typed form with no raw-JSON
    peeking needed: `entry.appearance: PanelAppearancePayload` decodes `chart: Option[ChartAppearance]`
    (so `entry.appearance.chart.flatMap(_.chartType)` is already a clean `Option[String]`, not raw JSON),
    and `decodeCreateConfig`'s own successful return value (when it's `PanelConfigCodec.ChartCreate(c)`)
    already carries the fully-resolved `c.aggregation: Option[JsObject]` — the exact same decode
    `DashboardSnapshotRepository.importSnapshot` will use to build the persisted panel, so there is no
    passthrough/pre-merge-representation risk here at all (unlike the ProposalPanel site, `entry.config` is
    one opaque JSON blob with no separate flat-vs-passthrough merge step to diverge from). Concretely: after
    `decodeCreateConfig` succeeds for a `"chart"`-typed entry, pattern-match its result and, when it's
    `ChartCreate(c)`, call `ChartPanel.rejectsAggregation(entry.appearance.chart.flatMap(_.chartType),
    c.aggregation.isDefined)`; `Some(msg)` → `Left(s"panel '${entry.snapshotId}': $msg")`, folded into
    `validatePanelEntries`'s existing per-entry `Either` accumulation (same zero-write pre-pass pattern as
    the other four sites — `validateSnapshotPayload` runs entirely before `dashboardRepo.importSnapshot`
    touches the database).

**D3 — Backward compatibility: pie renders differently, scatter doesn't.** A pre-existing panel with
`chartType: "pie"` and a stored `aggregation` will start rendering aggregated (the fix, not a regression
— raw-per-row was never the intended pie output). A pre-existing panel with `chartType: "scatter"` and a
stray stored `aggregation` (only reachable pre-fix, e.g. via direct API/MCP use before this validation
existed) keeps rendering raw points unchanged — the new validation only blocks *future writes*, it does
not retroactively touch stored rows or error on read/render. `ChartPanel.tsx`'s guard therefore stays a
three-way `bar|line|pie` allowlist (not a `!== "scatter"` denylist) so a legacy stray-scatter-aggregation
row keeps degrading exactly as it silently did before.

**D4 — UI: hide, don't just error.** `BindingEditor.tsx` passes the live in-progress `chartType` prop
(already threaded to `ChartDisplayFields`) into `ChartAggregationFields`'s render condition too: render
the Aggregation section for chart panels when `chartType !== "scatter"`; for scatter, render a short
inline note ("Aggregation isn't available for scatter — each point plots a raw row") mirroring the
existing empty-state note pattern (`ChartDisplayFields`'s scatter-fields-need-binding note). Switching
the live chart-type selector to scatter while an aggregation is already set in the open editor clears the
three aggregation fields client-side (mirrors "selecting None clears aggregation" from `panel-viz-
aggregation`'s metric requirement) so Save never round-trips a combination the backend would reject.

**D5 — Discoverability.** `schemas/panel.schema.json`'s `ChartConfig.aggregation` description gains a
one-line note: "Honored for bar/line/pie; rejected (400) in combination with `chartType: scatter`."
`create_panel`'s MCP description gains an `aggregation` bullet under the existing chart config bullet,
naming the three-way `groupBy/agg/yField` shape and the same restriction — the tool currently documents
`chartOptions`/`annotation` for chart but omits `aggregation` entirely.

## Risks / Trade-offs

- [Two independent chart-type sources: `appearance.chart.chartType` (mutable, patchable separately) vs.
  `config.aggregation` (separately patchable)] → mitigated by validating at the merged-effective level on
  every write path (D2), not just at config-patch time.
- [Raw JSON peek duplicates a little logic already present for `chartType` extraction] → kept intentionally
  parallel to the existing `chartTypeFromAppearanceJson`/`dataTypeIdFromConfigPatch` helpers rather than a
  new abstraction, matching the file's established style.
- [`ChartPanel.validateConfig` is now a real gate for the first time] → scoped narrowly (only the
  scatter+aggregation case); every other existing chart config remains `Right(())`, so no other panel
  behavior changes.
- [The `ProposalPanel`-based paths (apply-proposal, replace-contents) never route through
  `buildForCreate`'s `appearance`-carrying create call — `chartType` reaches the panel only via a later,
  best-effort PATCH whose failure is swallowed] → validated separately inside
  `ProposalPanelSupport.validatePanel`'s existing zero-write pre-pass (D2), checked against the flat
  `panel.chartType` and the *merged* (`buildCreateRequest`-resolved) `aggregation` key — not
  `panel.aggregation` alone — so the generic `config` passthrough (HEL-316) can't bypass it.
- [Pre-existing, out-of-scope gap surfaced while tracing this: neither apply-proposal's follow-up
  `applyAppearance` PATCH nor replace-contents reliably propagates a proposal panel's `chartType` today —
  replace-contents has no appearance-follow-up step at all, so a `ReplaceDashboardContentsRequest` chart
  panel's requested `chartType` is silently dropped regardless of this ticket] → not fixed here (predates
  this change, affects every chart type, not just scatter+aggregation, and is orthogonal to the
  scatter+aggregation validation this ticket adds); flagged as a spinoff candidate, not blocking.
- [`POST /api/dashboards/import` validates panel config *shape* only and enforces no cross-field rule at
  all today — not the `chartType` enum, not anything else. Adding this ticket's ONE scatter+aggregation
  check to `validatePanelEntries` closes this ticket's specific gap but could misleadingly read as "import
  is now validated" if left unqualified] → mitigated by the explicit Non-Goals callout above and by filing
  a dedicated spinoff ticket ("dashboard import bypasses panel appearance and cross-field validation",
  under HEL-344, referencing `skeptic-design-3.md`'s trace) that owns bringing import to parity with every
  other write path — this ticket's fix here is intentionally narrow.

## Planner Notes

Self-approved: implementing this as a genuine backend validation gate (not just a doc-only fix) satisfies
the ticket's explicit "reject it loudly... validate at panel create/update" instruction for scatter. No
new external dependency, no breaking change to any currently-succeeding write (only a write that combines
scatter + aggregation — undocumented and untested today — starts 400ing). Not escalated.
