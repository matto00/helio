## Why

A genuine double-click (or any rapid re-activation before the request settles) on the
Dashboard, Panel, or Pipeline-step "Duplicate" affordances fires two `POST .../duplicate`
requests, producing two clones from one user action. None of the three has an in-flight
guard today (HEL-412's final-gate skeptic caught this on the step surface and traced it
to the same pre-existing gap on dashboard/panel).

## What Changes

- Add a single shared in-flight-guard hook/idiom (e.g. `useInFlightGuard`) that disables
  re-entry synchronously (ref-based, not React-state-only, to be safe against two
  synchronous events in the same tick) while a duplicate request is pending, and clears
  the guard on both success and failure.
- Wire that guard into the three existing duplicate call sites: `PanelCard.tsx`'s
  `handleDuplicate`, `DashboardList.tsx`'s `handleDuplicateDashboard`, and
  `usePipelineDetailPage.ts`'s `handleDuplicateStep` (consumed by `StepCard.tsx` via
  `PipelineDetailPage.tsx`).
- Disable each duplicate button/menu-item while its own guard is active.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `dashboard-duplication`: the "Duplicate" action in the dashboard actions menu is
  guarded against re-entry while a duplicate request is in flight.
- `panel-duplication`: the duplicate button on a panel card is guarded against re-entry
  while a duplicate request is in flight.
- `pipeline-step-lifecycle`: the "Duplicate step" action is guarded against re-entry
  while a duplicate request is in flight.

## Impact

Frontend only, no backend/API/schema changes. Affected files: `PanelCard.tsx`,
`DashboardList.tsx`, `StepCard.tsx`, `PipelineDetailPage.tsx`,
`usePipelineDetailPage.ts`, plus a new shared hook/util. New frontend tests for the
double-activation case on each surface.

## Non-goals

- No change to the duplicate endpoints' server-side behavior or contracts.
- No change to other action buttons (Delete, Export, Rename) — scoped to Duplicate only.
