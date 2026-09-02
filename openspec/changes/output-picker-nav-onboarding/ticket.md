# HEL-909: P1.6 — Dashboard + nav + onboarding: Output picker, panel sheet, retire wizard/BindingEditor/Types/Metrics pages

## Description

Row **P1.6** of epic HEL-903 (Pipelines & Outputs remodel). Spec section
*Dashboard UX*, decisions 1, 6, 8, 11, 15
(`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` —
SOURCE OF TRUTH, wins over this ticket text wherever they disagree).

Today "Add panel" opens the four-screen `PanelCreationModal`
(`features/panels/ui/PanelCreationModal.tsx` + `creationSteps/*`); binding
was edited in `features/panels/ui/editors/*`. Nav is driven by
`shared/chrome/sections.ts` (with `registry` and `metrics` entries); onboarding
(`features/onboarding/OnboardingChecklist.tsx`, `onboardingSteps.ts`) teaches
a four-step source → pipeline → type → panel model.

Mockup: a searchable **Output picker** modal grouped by pipeline, each Output
rendered live with its placement count and an "already on this board" state;
one click places at the next free slot; content panels as a bottom row; "No
output fits? New pipeline · Ask the assistant". Panel edit sheet is small:
title override, size, appearance, link to the Output, Swap output, and an
"updates N dashboards" note pointing to the Output for anything about *what*
is shown.

### SCOPE EXPANSION (human ruling, 2026-09-01 — see premise-validation.md)

The ticket text as originally filed claimed P1.5 (HEL-908) had already
rewritten `features/panels/ui/editors/*` into the Output editor. Verified
FALSE against the live tree: HEL-908 explicitly left `PanelDetailModal` /
`MetricEditorForm` calling `selectPipelineOutputDataTypes` live, blocked on
spinoff **HEL-937** ("Migrate PanelDetailModal off dataTypesSlice/legacy
editors"). HEL-909's own literal AC (the repo-wide grep below) cannot pass
while `PanelDetailModal` still imports `BindingEditor.tsx`,
`CollectionEditor.tsx`, `TimelineEditor.tsx`, `TextContentEditor.tsx`,
`MetricPicker.tsx`, `DataTypePicker.tsx`, and `dataTypesSlice`.

Escalated to the human before worktree creation; **RULING: absorb HEL-937 into
this ticket's scope.** Mark HEL-937 cancelled/duplicate-of-HEL-909 once this
ships (not before — keep it visible in case something goes sideways).

This ticket's scope therefore now explicitly includes:
- Re-pointing `PanelDetailModal`'s panel-editing flow at the Panel sheet's own
  explicit data contract (resolved in design.md's "Panel sheet data source"
  section, round 1): the panel's own `outputId`, `GET /api/outputs/:id` (for
  the Output's `pipelineId` and display name), and `GET /api/outputs/:id/panels`
  (placement count) — **not** `GET /api/pipelines/:id/capabilities`, which is
  an Output-authoring concern owned by `OutputEditorSheet.tsx`, not a
  placement-editing one.
- Deleting `CollectionEditor.tsx`, `MarkdownEditor.tsx` (content-panel-only
  use must be confirmed first), `TimelineEditor.tsx`, `TextContentEditor.tsx`,
  `BindingEditor.tsx`, `MetricPicker.tsx`, `DataTypePicker.tsx`,
  `MetricBindingFields.tsx`, `fieldOptions.ts` (dataType-based parts),
  `useMetricBindingState.ts` once no longer imported anywhere.
- Removing `dataTypesSlice`/`metricsSlice` usage from `features/pipelines` and
  `features/panels` surfaces entirely; deleting now-dead selectors
  (`selectPipelineOutputDataTypes`, etc).
- Treating HEL-936's ~18-file `/api/types` frontend sweep as **the same
  migration**, not a separate one — call this out explicitly in design.md
  and in the PR body so a reviewer doesn't look for a seam that isn't there.

Per the human's own grounding (re-verify independently, don't take as given):
37 files under `frontend/src` reference `dataTypesSlice` or `/api/types`,
entangling `PanelCard.tsx`, `PanelCreationModal.tsx`,
`PanelCreationPreview.tsx`, `editors/TextContentEditor.tsx`, `types/panel.ts`,
and the whole detail-modal test suite. **Enumerate this as a class before
touching any file**: grep every reference, categorize by what it actually
needs (dead call to delete / read path to repoint at Outputs / test fixture
to rewrite), and write the axis down in design.md — the "Fix the class, not
the instance" lesson from P1.5 (see
`openspec/changes/archive/2026-09-01-pipeline-page-outputs-rebuild/design.md`
under "Step-Mutating Handler Enumeration" for the worked example this should
follow).

This is now expected to be a **large row** (P1.5 took 12+ cycles and was
better for it) — plan the migration in coherent chunks that each land
gate-green rather than one giant commit. Where a test is rewritten, prove it
still fails when the behavior it guards is broken (a test that still compiles
against a deleted concept is a blind gate).

## Scope

* **Output picker** replaces `PanelCreationModal`: search (⌘K-style type-ahead), grouped by pipeline, live thumbnails, placement counts, keyboard-operable (arrows + Enter places), content-panel row (text · markdown · image · divider), links to New pipeline / Assistant. Placing calls `POST /api/panels` with `kind: "output"` and **no** `layout`; the server applies the decision-15 defaults (metric 3×2 · chart 6×4 · table 6×6 · collection 6×4 · timeline 4×6 · markdown 4×4) and returns the placed layout, which the grid then renders — **the server is the single source of truth; no frontend copy of the constants** (no optimistic placement).
* **Panel sheet** replaces `BindingEditor` + metric binding UI inside `PanelDetailModal`: title override, appearance, Output link (to `/pipelines/:id` with the Output sheet opened), **Swap output** (re-uses the picker), placements note. Content panels keep their existing editors (non-dataType-based ones: image, divider, literal text/markdown).
* **Renderers** read rows via `GET /api/outputs/:id/rows` and config from the Output; panel-level aggregation code paths (HEL-292 client-side aggregate utils, `usePanelData`'s `/api/panels/:id/query` call in `panelThunks.ts:433-451`) are deleted, not disabled. The assertion-invalid badge on `PanelCard.tsx` reads `GET /api/outputs/:id/assertion-status`. Metric and `collection baseType: metric` renderers honour `config.format` (HEL-876).
* **Sources pages** stop calling `fetchDataTypes()` for schema preview (`SourcesPage.tsx:41-43`, `SourceDetailPage.tsx:40-44`, `EmptySchemaAffordance.tsx:42`, `AddSourceModal.tsx:91`) and read `inferredSchema` from the source payload instead.
* **Nav:** `sections.ts` = Dashboards · Pipelines · Sources · Connectors · Assistant; `AppRoutes.tsx` drops `/registry`, `/registry/:id`, `/metrics`, `/metrics/:id`; the mobile nav sheet and bottom nav lose those entries (absorbs HEL-789, HEL-793, HEL-784).
* **Onboarding:** three steps — connect a source · shape it into outputs · place them on a dashboard — with every glyph derived from the section registry (HEL-794), the Done button styled per DESIGN.md with a guard that asserts **computed** styles (jsdom `getComputedStyle` or a rendered probe) proven red against a deliberately broken cascade before the fix (HEL-792's second half), and a closing line that names **all five** nav destinations including Assistant and Connectors (HEL-793's surviving half). The mobile nav sheet offers a create action for every destination that has one on desktop, Assistant included (HEL-789's surviving half). Empty states on Sources / Pipelines / Dashboards updated to the new vocabulary; the Types empty state is gone with the page.
* **Delete:** `PanelCreationModal.tsx` + `creationSteps/*` + `PanelCreationPreview.tsx` + `panelTemplates.ts`, `TypeRegistryPage.tsx`, `TypeDetailPage.tsx`, `TypeDetailPanel.tsx`, `TypeListTable.tsx`, `ComputedFieldForm`/`ComputedFieldsEditor` entirely, `MetricsPage.tsx`, `MetricDetailPage.tsx`, `CreateMetricModal.tsx`, `MetricEditorForm.tsx`, `MetricListTable`, `AllowedDimensionsPicker`, the `metrics` and `dataTypes` Redux slices/services/thunks, `useCreatePanelAction`'s wizard dispatch. Plus (HEL-937 absorption) `BindingEditor.tsx`, `MetricPicker.tsx`, `DataTypePicker.tsx`, `CollectionEditor.tsx`, `TimelineEditor.tsx`, `TextContentEditor.tsx` (dataType-based path), `MetricBindingFields.tsx`, `useMetricBindingState.ts`, once no longer imported. Absorbs (frontend only) HEL-467, HEL-743, HEL-653, HEL-654, HEL-810, plus HEL-937.
* Mobile: the picker is the "create a simple panel on mobile" flow — verify at 375px/430px and close HEL-490 with this rather than building a separate guided flow.

## Acceptance criteria

- [ ] Playwright: from a dashboard, Add panel → type "throughput" → Enter → panel is on the grid with the chart's default size; open it → panel sheet shows title/appearance/Output link only; Swap output works. Interaction count recorded against the old wizard's (≥4 screens / ~5 clicks).
- [ ] Jest: picker groups by pipeline, marks already-placed Outputs, is keyboard-operable with correct focus order and accessible names (DESIGN.md §8); panel sheet never renders a field-mapping or aggregation control.
- [ ] `grep -rn "dataTypeId\|metricId\|/registry\|/metrics\|fetchDataTypes\|dataTypesSlice\|metricsSlice" frontend/src` returns nothing (P1.4 and P1.5 have already landed, so the whole frontend tree is in scope; this now includes the HEL-937 PanelDetailModal/editors migration per the ruling above). No route stubs, redirects, or "moved" pages (decision 11).
- [ ] `PanelDetailModal`'s panel-editing flow (the Panel sheet) is re-pointed at its own explicit data contract: the panel's own `outputId`, `GET /api/outputs/:id` (pipelineId + display name), and `GET /api/outputs/:id/panels` (placement count) — not `GET /api/pipelines/:id/capabilities`, which is an Output-authoring concern owned by `OutputEditorSheet.tsx`. `dataTypesSlice` usage removed from `features/pipelines`/`features/panels`; now-dead selectors deleted (HEL-937 AC, absorbed).
- [ ] E2E specs touching the retired surfaces are rewritten or deleted here: `e2e/hel666*` (`/registry`, `/metrics`), `e2e/hel773*:461`, `e2e/hel716-panel-creation-focus-trap*` (whole spec), `e2e/hel399*:121-123` (`config.dataTypeId`). OpenSpec specs for panel creation, panel types/binding, metrics, type registry, nav section registry, first-run onboarding are updated or removed; `check:openspec` green.
- [ ] Onboarding checklist shows three steps and completes on the new model; `sections.ts` snapshot test updated.
- [ ] Mobile nav sheet / bottom nav render five destinations; the ≥44px guard e2e passes.
- [ ] `npm run lint` / `typecheck` / `test` green.
- [ ] Every rewritten regression test proven red first (behavior it guards genuinely broken, then fixed) — no blind gates.

## Out of scope

Library drawer / drag-to-place (later, HEL-347); public dashboards (P1.7); multi-select / alignment (HEL-347 leaves, unaffected).

## Dependencies

Blocked by P1.3, HEL-725 and P1.5 (HEL-908) — sequential after the pipeline page. Blocks P1.7 (HEL-910).

## Release context

After HEL-910 (P1.7) merges, v0.7.8 is cut — the FIRST production deploy since
this remodel began. Production still runs the pre-remodel build (v0.7.7).
Nothing in this remodel has run in prod yet. Favor fixing over deferring on
anything user-visible; onboarding and nav are the first things a user
touches.
