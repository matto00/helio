## Context

`DashboardProposalService.buildCreateRequest` (`backend/src/main/scala/com/helio/services/
DashboardProposalService.scala`) only builds a `config` JsObject when `panel.dataTypeId` is present
(the bound trio). Non-data panels (text/markdown/image/divider) get an empty `CreatePanelRequest.config`,
which `PanelConfigCodec.decodeCreateConfig` tolerantly resolves to each subtype's `Empty` — e.g. `""`
content, `""` imageUrl. But `PanelConfigCodec.decodeCreateConfig` ALREADY accepts `content`/`imageUrl`/
`orientation` at create time (verified: `TextPanelConfig.decodeCreate`, `ImagePanelConfig.decodeCreate`,
`DividerPanelConfig.decodeCreate` are all tolerant JsObject decoders with no create-vs-update
distinction) — only the *proposal* layer never builds that JsObject. This is the smallest possible fix
for that half of the ticket: extend `ProposalPanel` + `buildCreateRequest`, no domain/config changes.

Chart appearance (`chartType`/axis titles/colors) is different: `PanelService.create` always seeds
`appearance = PanelAppearance.Default` (`PanelService.scala:128`) — appearance is only ever set via a
follow-up `PATCH /api/panels/:id`. `DashboardProposalService` already has a "create then best-effort
follow-up" precedent for exactly this shape: `applyLayout` calls `dashboardService.update` after all
panels are created and swallows a failure (panels already exist; layout is cosmetic). This design adds
an analogous `applyAppearance` step calling `panelService.update(..., UpdatePanelRequest(appearance =
Some(...)))` per chart panel that specifies appearance fields.

Metric literal `label`/`unit` has no existing config surface at all — confirmed by the `MetricRenderer.
tsx` comment (added by the just-merged HEL-295): "The literal-text override path (typed directly in
panel config, rather than resolved from a bound column) is out of scope for this ticket; see the
sibling config-depth ticket" — that sibling ticket is this one.

## Goals / Non-Goals

**Goals:**
- A proposed text/markdown panel with `content` renders that content immediately on apply.
- A proposed chart panel with `chartType`/axis titles applies as that chart type with those axes — no
  manual `PanelDetailModal` edit needed.
- A proposed metric panel can carry a literal `label`/`unit` that renders even when the bound DataType
  has no matching column (or the agent doesn't want to bind one for display text).
- Zero behavior change for existing proposals that omit all new fields.

**Non-Goals:**
- No `BindingEditor`/`PanelDetailModal` UI for the metric literal override — proposal/config-surface
  only, per the ticket's acceptance criteria (agent path). A human can still set it via `create_panel`'s
  already-generic `config` passthrough (unaffected by this change) once the backend accepts the fields.
- No changes to `fieldMapping`-bound `label`/`unit` slots or to HEL-292's `aggregation` spec — additive.
- No validation change to the existing manual chart-appearance PATCH path (`resolvePatch`) beyond what's
  needed to keep proposal-sourced values sane (see Decision 6, which validates in `validateStructure`,
  not in `resolvePatch`) — closing that pre-existing manual-PATCH gap generally is out of scope.

## Decisions

**1. Non-data panel content flows through the EXISTING create-config decoder — only `ProposalPanel` and
`buildCreateRequest` change.** `ProposalPanel` gains `content: Option[String]` (text/markdown), `url:
Option[String]` (image; wire name `url` per the ticket, mapped internally to `ImagePanelConfig.imageUrl`
— proposal fields don't have to mirror panel-config field names 1:1, and `url` is the more natural name
for an agent authoring a proposal), and `orientation: Option[String]` (divider). `buildCreateRequest`
builds the per-type config: `{content}` / `{imageUrl: url, imageFit: "contain"}` / `{orientation}` —
mirroring the existing `dataTypeId`-branch pattern (build a `JsObject` from whichever proposal fields
are present, `None` when the type doesn't use that field). No `PanelConfigCodec`/domain changes.

**2. Chart appearance is a best-effort follow-up PATCH, exactly like `applyLayout` — but the VALUES it
applies are pre-validated before any creation happens (see Decision 6).** New `applyAppearance(dashboard,
proposalPanels, createdPanels, user)` runs after `createPanels`, alongside `applyLayout`. For each
`(proposal, created)` pair where `created.kind == "chart"` and at least one of `chartType`/`xAxisLabel`/
`yAxisLabel`/`seriesColors` is set, build a `ChartAppearance` (new `ChartAppearance.Default` constant in
`model.scala`, mirroring `PanelAppearance.Default`, using the same defaults the frontend's
`DEFAULT_CHART_APPEARANCE` — `PanelDetailModal.tsx:35` — already renders, so a proposal-created chart
and a manually-edited one converge on the same look) overridden field-by-field from the (already-valid)
proposal, then `panelService.update(created.id, UpdatePanelRequest(appearance =
Some(PanelAppearancePayload(None, None, None, Some(appearance))), ...), user)`. `applyAppearance` itself
performs NO validation and has NO failure-to-reject path — by the time it runs, `chartType` has already
been checked in `validateStructure` (Decision 6), so the only failures it can hit are the same
transient/infra failures `applyLayout` already tolerates (panel already exists; appearance is cosmetic
relative to the panel's existence). This resolves what would otherwise be a contradiction: a "reject
before creating anything" requirement cannot be satisfied by a step that, by design, runs after creation
and swallows failures — so ALL rejection happens earlier, in `validateStructure`, before `createAll` is
even called. Alternative considered: extend `PanelService.create` to accept an initial appearance —
rejected as a wider blast radius (every panel-create call site, not just proposals) for a proposal-only
need.

**3. Metric literal override: typed fields on `MetricPanelConfig`, not an opaque JsObject.**
`MetricPanelConfig` gains `label: Option[String] = None, unit: Option[String] = None` (bumping
`jsonFormat3` → `jsonFormat5`), with a normal tolerant `decode`/`Patch.decode` (absent-vs-null) exactly
like every other typed field in the file — NOT the opaque-JsObject treatment `aggregation` got, because
`aggregation`'s opacity was deliberate (the backend never interprets it); `label`/`unit` are simple
strings the backend should validate the same way `content`/`imageUrl` already are (length-bounded via
the panel title convention — no length cap enforced today for `content` either, so none added here).
`ProposalPanel` carries them as top-level `label`/`unit` (sibling to `fieldMapping`, not nested inside
it) — the wire path `config.label` is unambiguous from `config.fieldMapping.label` (a column-name
string) even though both use the word "label"; schema descriptions on both fields cross-reference each
other to head off confusion.

**4. Frontend precedence: literal wins over fieldMapping-resolved.** `usePanelData.ts`'s `data` memo
builds `mapped` from `fieldMapping` (Decision 3 of HEL-292's design carries `metricAggregation`'s
`value` override); this change adds, after that block: `if (literalLabel) mapped.label = literalLabel;
if (literalUnit) mapped.unit = literalUnit;` sourced from a new `getMetricLiteral(panel)` narrowing
helper in `panelNarrowing.ts` (mirrors `getMetricAggregation`). This must NOT participate in the memo's
early-return guard (`rows.length === 0 || (!fieldMappingKey && !metricAggregation)`) — a metric with
only a literal label/unit and a bound `value` aggregation/mapping still needs `fieldMappingKey` or
`metricAggregation` truthy for `mapped` to compute at all, which is already guaranteed whenever the
panel has a `value` binding; a metric with a literal label but NO value binding renders `--`/`No data`
unchanged (labels alone were never a "has data" signal per HEL-295 — see `MetricRenderer.tsx`'s
`hasValue` guard).

**5. New nullable `panels` columns for the literal override — same durable-persistence lesson HEL-292's
design.md flagged.** A Flyway `V44__panel_metric_literal_columns.sql` adds `metric_label TEXT` and
`metric_unit TEXT` (nullable). `PanelRow`/`PanelTable` gain matching fields; `PanelRowMapper.
domainToRow`/`metricConfig` read/write them for the metric branch only. Critically, `PanelRepository.
replace`'s explicit column tuple (`typeId, fieldMapping, content, imageUrl, imageFit,
dividerOrientation, dividerWeight, dividerColor, aggregation, lastUpdated`) MUST be extended to include
`metricLabel`/`metricUnit`, or a config PATCH silently drops them on write exactly as HEL-292's cycle-2
bug did for `aggregation`. `insert` is unaffected (writes the full row via `domainToRow`).

**6. Validate `chartType` AND divider `orientation` in `validateStructure`, before ANY creation —
not inside the best-effort follow-up steps.** `resolvePatch` (manual PATCH) passes
`PanelAppearancePayload.chart` through with no validation today, and `DividerPanelConfig.decodeCreate`
(reused by `decode`) performs no validation either (only its `Patch.decode`, the manual-PATCH path,
validates via `RequestValidation.validateDividerOrientation`) — both are pre-existing gaps, not this
change's to fix broadly for the manual-edit paths. But an agent-authored proposal is untrusted input the
same way `imageFit`/`dividerOrientation` already are on other paths, so `DashboardProposalService.
validateStructure` (which already runs entirely before `createAll`/`preValidateBindings` — see
`DashboardProposalService.scala:42-49` — and already 400s on a bad panel type/missing title/missing
dataTypeId) gains two more per-panel checks: a chart panel's `chartType` (when present) against a new
`RequestValidation.validateChartType` allow-list (`bar`, `line`, `pie`, `scatter` — the same four
`ChartAppearanceEditor.tsx` already renders), and a divider panel's `orientation` (when present) against
the EXISTING `RequestValidation.validateDividerOrientation`. Both return `ServiceError.BadRequest` via
the same `Left(s"$where: ...")` convention `validateStructure` already uses, so nothing is created for a
malformed proposal — `applyAppearance`/`buildCreateRequest` then only ever see already-valid values,
which is what makes Decision 2's "no validation, no reject path" claim correct.

## Risks / Trade-offs

- [`applyAppearance`'s PATCH is a second round-trip per chart panel after create] → Same cost profile
  `applyLayout` already accepted; proposals are a few panels, not a hot path.
- [Two "label" concepts in the same `MetricConfig` JSON object (`label` vs `fieldMapping.label`)] →
  Mitigated by schema description cross-references and Decision 4's explicit precedence rule; flagged
  here so the evaluator/skeptic checks the schema prose, not just the code.
- [`ChartAppearance.Default` duplicates `PanelDetailModal.tsx`'s `DEFAULT_CHART_APPEARANCE` in a second
  language] → Accepted: the two are read at different times (backend default only fires when a proposal
  under-specifies chart appearance; the frontend default seeds the manual editor) and drift is low-risk
  cosmetic (fallback colors), not correctness-bearing.

## Planner Notes

- Self-approved: wire name `url` (proposal) → `imageUrl` (config) instead of forcing 1:1 field-name
  parity — the proposal is an agent-facing authoring surface (per `dashboard-proposal.schema.json`'s own
  description), so ergonomic naming there takes precedence over mechanical mirroring of the internal
  config shape.
- Self-approved: no `BindingEditor` UI for the metric literal override (Non-Goals) — ticket acceptance
  criteria is scoped to the agent/proposal path, and adding a manual editor is unrequested scope per
  "Keep changes focused on the requested task."
