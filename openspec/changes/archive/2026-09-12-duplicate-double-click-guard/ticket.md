# HEL-706: Duplicate buttons on step/dashboard/panel allow double-click double-clones (no in-flight guard)

## Description

HEL-412's final-gate skeptic found that a genuine double-click on the new "Duplicate step" button creates two clones — and confirmed this is an exact match for the pre-existing, unguarded duplicate patterns on the Dashboard and Panel duplicate buttons that HEL-412's design deliberately modeled itself on. Not a regression; a shared latent UX defect across all three surfaces.

## Scope

- Add an in-flight guard (disable the button / ignore re-entry while the duplicate POST is pending) uniformly to:
  - Pipeline step duplicate (`frontend/src/features/pipelines/ui/StepCard.tsx` / `PipelineDetailPage.tsx` / `usePipelineDetailPage.ts`, HEL-412)
  - Dashboard duplicate (`frontend/src/features/dashboards/ui/DashboardList.tsx`, `POST /api/dashboards/:id/duplicate` caller)
  - Panel duplicate (`frontend/src/features/panels/ui/PanelCard.tsx`, `POST /api/panels/:id/duplicate` caller)
- Keep the pattern consistent across the three (one shared idiom, not three ad-hoc fixes).

## Acceptance Criteria

- [ ] A double-click on any of the three duplicate affordances produces exactly one clone.
- [ ] The affordance re-enables after the request settles (success or failure).
- [ ] Frontend tests cover the double-activation case for each surface.
- [ ] The guard is re-entry-proof against synchronous double-activation in the same tick (a guard implemented via React state alone, set asynchronously via `setState`, can lose this race — a ref-based or otherwise synchronous guard is required).

## Origin

Standalone follow-up triaged out of HEL-412 (coordinator decision: spans dashboard/panel/step patterns uniformly, bigger than that ticket).

## Confirmed current file locations (2026-09-12 premise check)

- `frontend/src/features/pipelines/ui/StepCard.tsx` (button), `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` (`handleDuplicateStep`), `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` (wiring) — paths unchanged since ticket filing.
- `frontend/src/features/dashboards/ui/DashboardList.tsx` (`handleDuplicateDashboard`).
- `frontend/src/features/panels/ui/PanelCard.tsx` (`handleDuplicate`).
- No other duplicate affordances found (command palette, mobile nav, keyboard shortcuts all checked — none exist for these entities).
