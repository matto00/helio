## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, both spec deltas, and `tasks.md` in full.
- Confirmed the current render guard and pie/aggregate handling in
  `frontend/src/features/panels/ui/ChartPanel.tsx:202` (`useAggregate = chartAggregate != null &&
  (chartType === "bar" || chartType === "line")`) and `buildAggregateDataOption` (bar/line-shaped
  `{xAxis, series}`, no pie branch) — matches design.md's stated starting point (D1).
- Confirmed `applyPie` in `frontend/src/utils/chartTypeOptions.ts:116-135` operates generically on
  `series[0]`'s `{name,value}` data — needs no change, as D1 claims.
- Confirmed `ChartPanel.validateConfig` in
  `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala:300` is currently a hardcoded
  `Right(())` — matches design.md's "Context" claim.
- Traced every write path design.md claims funnels through `PanelService.buildForCreate`:
  - `PanelService.create` → `buildForCreate` (`PanelService.scala:125`).
  - `PanelService.batchCreate` → `buildAllForCreate` → `buildForCreate` (`PanelService.scala:197,336`).
  - `DashboardContentsService.buildPanels` → `panelService.buildAllForCreate`
    (`DashboardContentsService.scala:91`).
  - `BoundPanelService.createPanel` → `panelService.buildForCreate`, and — importantly — passes
    `appearance = request.panel.appearance` straight through (`BoundPanelService.scala:233-244`), so
    `chartType` IS present at that create call.
  - `DashboardProposalService.createPanels` → `panelService.create` (`DashboardProposalService.scala:103`)
    → `buildForCreate`. **However**, tracing what's actually inside that create call for a proposal panel
    (see Change Request 1) shows the coverage claim doesn't hold for the scatter case.
- Confirmed `PanelService.update`'s HEL-362 full-merge semantics
  (`PanelServiceHelpers.resolvePatch` → `PanelAppearance.applyPatchJson`, `model.scala:274-280`) really
  does return a fully-merged `PanelAppearance`, not a bare patch — validates D2's
  `effectiveChartType = spec.appearance.orElse(Some(existing.appearance))...` formula as correct for the
  single-PATCH path.
- Confirmed `PanelServiceHelpers`'s existing raw-JSON-peek helpers (`chartTypeFromAppearanceJson`,
  `dataTypeIdFromConfigPatch`) that the new `aggregationPresenceFromConfigPatch` /
  `validateBatchAggregationConflict` are meant to mirror (`PanelServiceHelpers.scala:83-104,205-210`) —
  the pattern exists and is reused correctly by `batchUpdate`'s pre-write `for`-comprehension
  (`PanelService.scala:275-278`).
- Read `PanelBindingSpec.scala` in full — confirmed it documents `fieldMapping` slot eligibility only
  (`xAxis/yAxis/series/annotation` for chart), never chart-type or aggregation semantics. Design.md's "no
  divergence, nothing to keep in sync" claim is correct.
- Confirmed `schemas/panel.schema.json`'s `ChartConfig.aggregation` (line 97) and `ChartAggregation` $def
  (lines 250-259) carry no restriction language today, and `helio-mcp/src/tools/write.ts`'s `create_panel`
  description (lines 399-465) never mentions `aggregation` — both discoverability gaps are real and the
  planned edits (tasks 2.1/2.2) target them correctly.
- Confirmed `BindingEditor.tsx` already threads a live `chartType` prop (sourced from
  `PanelDetailModal.tsx`'s `useState<ChartAppearance>` — `chartAppearance.chartType`, `PanelDetailModal.tsx:63,97,246`)
  into `ChartDisplayFields` (`BindingEditor.tsx:406`), confirming D4's claim that a live, in-progress
  chart-type value is already available in-editor to gate `ChartAggregationFields`'s render condition
  (currently un-gated, `BindingEditor.tsx:389-399`).
- **Critically traced the apply-proposal path end-to-end** (`ProposalPanelSupport.buildCreateRequest` /
  `buildDataConfig`, `DashboardProposalService.createPanels` / `applyAppearance`,
  `CreatePanelRequest`'s `appearance: Option[PanelAppearancePayload] = None` default,
  `PanelAppearance.Default` having `chart = None`) — this surfaced Change Request 1 below, a concrete gap
  the design's "verified by reading each call site" claim does not actually hold up against.

### Verdict: REFUTE

### Change Requests

1. **Apply-proposal is not actually covered — design.md's D2 coverage claim is false for the scatter
   case, and this is exactly the write path the ticket names as required to reject loudly.**

   Trace: `DashboardProposalService.createPanels` (line 103) builds each chart panel's `CreatePanelRequest`
   via `ProposalPanelSupport.buildCreateRequest` (`ProposalPanelSupport.scala:95-107`), which **never sets
   `appearance`** — only `dashboardId`/`title`/`type`/`config` are populated, and `aggregation` is folded
   into `config` (`buildDataConfig`, line 135) but `chartType` is not part of `config` at all (it lives in
   `appearance.chart.chartType`). Since `CreatePanelRequest.appearance` defaults to `None`
   (`PanelProtocol.scala:58`), `PanelServiceHelpers.resolveCreateAppearance` falls back to
   `PanelAppearance.Default`, whose `chart` field is `None` (`model.scala:307-311`) — not even
   `ChartAppearance.Default`. So **the create-time `buildForCreate` call the design validates never
   actually carries the proposal's requested `chartType`** — `effectiveChartType` at create time is always
   `None`, so `ChartPanel.rejectsAggregation` never fires there, no matter what the proposal asked for.

   The proposal's `chartType` is instead applied via a **separate, later, best-effort PATCH**:
   `DashboardProposalService.applyAppearance` (lines 162-188) issues a second `panelService.update` call
   (which WOULD trigger the new update-path scatter+aggregation check per D2, since by then
   `config.aggregation` is already stored from the create step). But its result is explicitly swallowed:
   ```scala
   panelService.update(created.id, request, user).map {
     case Right(updated) => acc :+ updated
     case Left(_)        => acc :+ created // appearance is cosmetic; panel already exists
   }
   ```
   Concrete failure mode once this ticket ships as designed: an agent submits a proposal with a chart panel
   `{type: "chart", chartType: "scatter", aggregation: {...}}`. The dashboard and panel are created
   successfully (chartType absent at create time → no rejection). The follow-up appearance PATCH correctly
   400s per the new update-path validation — but that 400 is discarded, and the panel is kept with its
   **default appearance** (`chart: None`, renders as a line chart) while `config.aggregation` remains
   attached. `DashboardProposalService.apply` returns `Right(...)` — the whole call **succeeds** with a
   200/201, no error anywhere, and the caller's explicit `chartType: "scatter"` request was silently
   discarded in favor of a different chart type. This is the exact "silent ignoring" failure mode the
   ticket rules out, just relocated to write-time on the one path (`apply-proposal`) the ticket explicitly
   names.

   Required fix: extend `ProposalPanelSupport.validatePanel` (already the place that validates a chart
   panel's `chartType` enum validity up front, `ProposalPanelSupport.scala:36-38`) to also reject a chart
   panel combining `chartType: "scatter"` with a present `panel.aggregation`, so the conflict is caught
   during `validateStructure`'s zero-side-effect pre-pass — consistent with this service's own documented
   "atomicity: all panel bindings are validated up front" contract — rather than relying on the
   create-then-patch sequence to ever see the combination together. Update design.md D2 and tasks.md
   (section 1 and/or a new task) to specify this explicitly, and add a test asserting a scatter+aggregation
   proposal panel 400s the *entire* `apply-proposal` call with zero dashboard/panel created (mirroring the
   existing binding-validation tests), not merely that the follow-up appearance patch would reject it.

   (Secondary finding, not blocking on its own, but worth noting in the same revision: `buildCreateRequest`
   is also used verbatim by `DashboardContentsService.buildPanels` for `replace-contents`, and that service
   has no equivalent `applyAppearance` follow-up at all — meaning replace-contents-created chart panels
   never receive a requested `chartType` through any path today, pre-existing and out of this ticket's
   scope, but it further weakens the "verified by reading each call site" confidence stated in design.md;
   the design should at least acknowledge this pre-existing limitation rather than imply chartType
   propagation was checked and found sound for both paths.)

2. **The update-path validation is specified over generic `Panel` but its logic only type-checks for a
   `ChartPanel` — the required type-narrowing guard is missing from the design.**

   Design.md D2 / tasks.md 1.4 describe
   `PanelServiceHelpers.validateScatterAggregationConflict(existing: Panel, spec: ResolvedPanelPatch)`
   computing `effectiveAggregationPresent = ... .getOrElse(existingChartConfig.aggregation.isDefined)`.
   `PanelAppearance.chart: Option[ChartAppearance]` is a field on every panel kind's shared
   `PanelAppearance` (`model.scala:130`) — it is not type-restricted to chart panels — so `existing` could
   structurally be, e.g., a `TablePanel` carrying an incidental (dead, non-rendered) `appearance.chart`
   value. `existingChartConfig.aggregation` only exists on `ChartPanelConfig`
   (`ChartPanel.scala:181-187`), not on the trait `Panel`'s common interface, and not on other subtypes'
   configs — so the pseudocode as written requires narrowing `existing` to `ChartPanel` first (e.g.
   `existing match { case cp: ChartPanel => ...; case _ => Right(()) }`), a step design.md never states.
   Please add this guard explicitly (skip the check entirely — return `Right(())` — for any panel whose
   `kind != ChartPanel.Kind`) so the implementer doesn't have to invent it mid-implementation, and add a
   corresponding case to tasks.md 5.5 ("a non-chart panel PATCH is unaffected even if it carries an
   incidental `chart.chartType`").

### Non-blocking notes

- The pie/scatter split itself is well-justified and not a half-measure: pie's `{name,value}` semantic is
  the obvious, uncontroversial mapping of an existing categories/values aggregate; scatter's raw
  coordinate-pair semantic genuinely has no meaning for a categorical `groupBy` aggregate. This satisfies
  the ticket's "pick one deliberately, rule out silent-ignore" instruction on the merits.
- D3's backward-compatibility story (pie renders differently going forward = the fix; legacy stray
  scatter+aggregation rows keep degrading exactly as before, allowlist not denylist) is sound and
  consistent with the existing frontend code style.
- `ChartPanel.rejectsAggregation`'s exact error-message wording is left to the implementer — fine, not
  worth pinning down at the design gate.
