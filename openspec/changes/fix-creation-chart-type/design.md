# Design — fix-creation-chart-type (HEL-305)

## Context

The creation modal (step 3) collects a `TypeConfig` (`frontend/src/features/panels/types/panel.ts`
lines 405–409): metric `valueLabel`/`unit`, chart `chartType`, image `imageUrl`. `seedCreateConfig`
in `frontend/src/features/panels/state/panelPayloads.ts` only honors the image variant; the metric
and chart arms seed nothing beyond `dataTypeId`. Chart type is not a config field at all: it lives on
`appearance.chart.chartType` (`ChartAppearance`), rendered via `chartAppearance.ts` with
`?? "line"` fallback, and the backend `PanelService.create` unconditionally applies
`PanelAppearance.Default` (`PanelService.scala:128`). `CreatePanelRequest`
(`PanelProtocol.scala:47`) has no `appearance` field. Note: the ticket cites the file as
`utils/panelPayloads.ts`; the actual path is `state/panelPayloads.ts`.

## Goals / Non-Goals

**Goals:**

- Creation-time chart type takes effect on first render, atomically (single create request).
- Creation-time metric value label / unit are seeded into the created config.
- Payload tests pinning the carried fields; copy fix in `TypeSelectStep.tsx`.

**Non-Goals:**

- Moving `chartType` into `ChartPanelConfig`; exposing chartOptions/appearance editing at create;
  fixing the missing `collection` enum entry in `create-panel-request.schema.json`.

## Decisions

### D1 — Carry chart type via an optional `appearance` on `CreatePanelRequest` (not a follow-up PATCH)

Chosen: add `appearance: Option[PanelAppearance]` to `CreatePanelRequest`; `PanelService.create`
uses it when present — normalized like the PATCH path (`RequestValidation.normalizePanelBackground`/
`normalizePanelColor`/`normalizeTransparency`, mirroring `PanelServiceHelpers.resolvePatch`) plus a
`RequestValidation.validateChartType` check — else `PanelAppearance.Default`. Note: today
`validateChartType`'s only caller is `DashboardProposalService` (the AI-proposal flow); neither the
PATCH path (`PanelServiceHelpers.resolvePatch` → `PanelPatchApplier`) nor any DB constraint
validates `chartType`. This change **newly wires chartType validation into ordinary panel CRUD** —
it is not a reuse of existing PATCH validation (see D6 for the resulting parity decision). Frontend
`buildCreatePanelBody` emits `appearance` **only** when `typeConfig.type === "chart"` and
`chartType` is set: `{ ...defaultPanelAppearance, chart: { ...defaultChartAppearance, chartType } }`.

Alternative considered — frontend-only chained `PATCH /api/panels/:id` (appearance) after the POST,
before the thunk's awaited `fetchPanels`. Rejected: two round trips with a transiently-wrong stored
panel (a failed PATCH silently strands a line chart), and it fails the AC's literal requirement that
`buildCreatePanelBody` carries `chartType` into the **create** payload. The additive optional field
is non-breaking (existing clients omit it; backend behavior unchanged when absent) and matches the
existing appearance codec — `JsonProtocols` already round-trips `PanelAppearance` for PATCH.

### D2 — Metric `valueLabel`/`unit` seed `config.label`/`config.unit` (frontend-only)

`MetricPanelConfig.label`/`unit` (HEL-293 literal display overrides) are exactly what the creation
inputs collect ("Value label", "Unit" — `MetricCreatorFields.tsx`), and the backend create decode
(`MetricPanel.scala` `decode`, schema `$defs.MetricConfig`) already accepts them. Seed them in the
`metric` arm of `seedCreateConfig` when non-empty. No backend change needed.

### D3 — Share the default chart appearance instead of duplicating it

`DEFAULT_CHART_APPEARANCE` is module-private in `PanelDetailModal.tsx` and mirrored backend-side by
`ChartAppearance.Default`. Move it next to `defaultPanelAppearance` in
`frontend/src/theme/appearance.ts` (exported) and re-import in `PanelDetailModal.tsx`, so the create
path composes the same base rather than a second copy. Behavior-preserving move.

### D4 — Copy fix

`TypeSelectStep.tsx:38` description becomes copy naming line, bar, pie, and scatter (e.g.
"Visualize trends with line, bar, pie, or scatter"). Pinned by a `panel-type-picker-cards` delta
scenario.

### D5 — Close the create/PATCH chartType-validation asymmetry (parity in `resolvePatch`)

Validating chartType at create only would leave the update paths silently persisting invalid values
(e.g. `"donut"`) — a pre-existing gap confirmed at the design gate. There are **three**
appearance-write paths: (1) create (this change's new optional `appearance`); (2) single-item
`PATCH /api/panels/:id` via `PanelServiceHelpers.resolvePatch` — currently has **no UI caller**
(`updatePanelAppearance` thunk is unreferenced from components); (3) `POST /api/panels/updateBatch`
via `PanelService.batchUpdate` → `PanelMutationRepository.batchUpdate` — the path the live edit UI
actually uses (`PanelDetailModal.tsx` → `usePanelUpdatesFlush.ts` → `updatePanelsBatch`), which
bypasses `resolvePatch` entirely. Chosen: add the same `RequestValidation.validateChartType` check
to **both update paths** — the appearance branch of `resolvePatch`, and a pre-DBIO validation step
in `PanelService.batchUpdate` (validate every item's `appearance.chart.chartType` **before**
building the single `transactionally` action, so an invalid item fails the whole batch cleanly with
a 400 and no partial write). Rationale: small, low-risk, shares the one validator the create path
introduces; the frontend only ever sends valid values, so only malformed API/agent clients are
affected — tightening rejection of invalid input is not treated as breaking. Alternative (declare
the update-path gaps out of scope with a spinoff) rejected: shipping the asymmetry invites
divergent client behavior, and the batch path is the one real edits use.

### D6 — Tests

- `panelPayloads.test.ts`: chart create with `chartType` → body carries
  `appearance.chart.chartType` (and no `appearance` key when chartType unset / non-chart types);
  metric create with `valueLabel`/`unit` → `config.label`/`config.unit`; empty strings omitted.
- Backend ScalaTest: create with `appearance` persists it; create without keeps
  `PanelAppearance.Default`; invalid `chartType` in create appearance → 400; invalid `chartType` in
  PATCH appearance → 400 (D5 parity); valid PATCH appearance still persists; batch update with an
  invalid `chart.chartType` on any item → 400 with no partial write; valid batch appearance still
  persists.

## Risks / Trade-offs

- [Create accepts full appearance — wider surface than strictly needed] → Mitigation: it reuses the
  existing PATCH appearance **wire shape and codec** (`PanelAppearancePayload`/`JsonProtocols`); no
  new shape is invented. chartType validation, however, is genuinely new to panel CRUD (D1/D5) and
  is added to both write paths in this change. Documented in the schema description.
- [Update-path tightening (D5: single PATCH + batch) rejects previously-accepted invalid chartType
  values] → Only malformed API/agent clients are affected; the UI never sends invalid values. No
  stored-data migration needed (render path already falls back safely; no known invalid rows). Batch
  validation runs before the transactional DBIO so a bad item yields a clean 400, never a partial
  write.
- [Frontend default appearance drifts from `PanelAppearance.Default`/`ChartAppearance.Default`] →
  Pre-existing mirror (noted in `ChartAppearance.Default` comment); D3 reduces frontend copies to
  one. No new drift source added.
- [`hasNonEmptyTypeConfig` gating: modal omits `typeConfig` when all fields empty] → unchanged
  behavior; payload builders treat absent/empty typeConfig as today.

## Planner Notes (self-approved decisions)

- Additive optional `appearance` on `POST /api/panels` judged non-breaking and in-scope for the AC
  ("carries `chartType` into the create payload"); not escalated.
- Ticket's file path corrected (`state/` not `utils/`); no scope impact.
- Mobile standard: no new controls are added; copy-only UI change. Evaluator should still sanity-
  check the creation flow at 390×844 per session standard.
