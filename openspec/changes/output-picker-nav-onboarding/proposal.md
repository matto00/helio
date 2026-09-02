# Proposal: Output Picker, Panel Sheet, Nav/Onboarding Retirement (HEL-909, P1.6)

## Why

P1.5 (HEL-908) shipped the pipeline-page Output editor but left the
dashboard/nav/onboarding surfaces on the old Source→Pipeline→DataType→Metric→
Panel model. `main` has been non-functional as a working web app since P1.3
(spec decision 17) — this ticket is the row that closes that gap. It also
absorbs spinoff HEL-937 (PanelDetailModal off legacy dataType-keyed editors)
per human ruling, since HEL-909's own AC cannot pass otherwise (see
`ticket.md` "SCOPE EXPANSION" and `premise-validation.md`).

## What changes

- **Output picker** (new) replaces `PanelCreationModal` + `creationSteps/*` as
  the "Add panel" flow on a dashboard: search grouped by pipeline, live
  Output cards, placement counts, keyboard nav, content-panel row.
- **Panel sheet** (new, small) replaces the binding/aggregation UI inside
  `PanelDetailModal`: title override, appearance, Output link, Swap output,
  placements note. Content panels keep literal editors (image, divider,
  literal text/markdown) — **not** dataType-keyed.
- **Renderers** (`PanelCard`, `CollectionRenderer`, `TableRenderer`,
  `TimelineRenderer`, plus panel state: `panelThunks`, `panelsSlice`,
  `panelPayloads`, `panelNarrowing`, `types/panel.ts`) read
  `GET /api/outputs/:id/rows` / `GET /api/outputs/:id/assertion-status`
  instead of `/api/types/:id/rows` / panel-level query/aggregation.
- **Sources pages** (`SourcesPage`, `SourceDetailPage`,
  `EmptySchemaAffordance`, `AddSourceModal`) read `inferredSchema` off the
  source payload instead of calling `fetchDataTypes()`.
- **Nav** (`sections.ts`, `SidebarBody`, `MobileNavSheet`, `navDestinations`,
  `usePickerSelection`, `pickerEmptyState`) drops `registry`/`metrics`
  entries; five destinations remain: Dashboards · Pipelines · Sources ·
  Connectors · Assistant.
- **Onboarding** (`OnboardingChecklist`, `onboardingSteps`) becomes three
  steps: connect a source · shape it into outputs · place them on a
  dashboard; Done button computed-style guard; closing line names all five
  nav destinations.
- **Delete outright**: `features/dataTypes/*`, `features/metrics/*`,
  `PanelCreationModal.tsx` + `creationSteps/*` + `PanelCreationPreview.tsx` +
  `panelTemplates.ts`, `ComputedFieldForm`/`ComputedFieldsEditor`, and (HEL-937
  absorption) `BindingEditor.tsx`, `MetricPicker.tsx`, `DataTypePicker.tsx`,
  `CollectionEditor.tsx`, `TimelineEditor.tsx`, `TextContentEditor.tsx`
  (dataType-keyed path), `MetricBindingFields.tsx`, `useMetricBindingState.ts`
  — once each has zero remaining importers.
- **E2E**: `e2e/hel666*`, `e2e/hel773*:461`, `e2e/hel716-panel-creation-focus-trap*`,
  `e2e/hel399*:121-123` rewritten or deleted. New/updated specs cover the
  Output picker flow and the five-destination nav.
- **OpenSpec**: capability specs for panel creation, panel binding, metrics,
  type registry, nav section registry, first-run onboarding updated/removed.

## Impact

Frontend-only (backend Output/panel routes already shipped in P1.3/P1.5).
Affected capabilities: `panel-creation-ui`, `panel-binding-ui` (or
equivalent), `dashboard-nav`, `onboarding-first-run`, `metrics-registry`,
`type-registry`. No schema/migration changes — this is UI + Redux + routing.

## Non-goals

Library drawer / drag-to-place (HEL-347); public dashboards (P1.7);
multi-select/alignment (HEL-347).
