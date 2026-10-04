## Why

HEL-1071 grandfathers a stored breakpoint that is identical to what is stored, so dashboards saved before it keep
overlapping or out-of-bounds breakpoints forever; HEL-1023 only repairs them at render. A dashboard exported in that
state 400s on import. The owner has ruled (see `ticket.md`): repair on open by the owner, write once, no undo entry, no
dirty flag; non-owners never write; import stores repaired.

## What Changes

- New owner-only endpoint `POST /api/dashboards/:id/layout/repair`: accepts replacement breakpoints for breakpoints
  that are currently stored-bad, validates them with the HEL-1071 validator plus panel-id integrity checks (no live
  panel's item dropped), and writes them without bumping `lastUpdated`. A breakpoint that is no longer stored-bad is
  ignored, so a repeat call writes nothing.
- The web client, when the signed-in user owns the open dashboard and its panels are loaded, sends the displayed
  (render-time resolved, HEL-1023) layout for each stored-bad breakpoint once. The store write is server truth under
  the HEL-1230 classification contract: no undo entry, no dirty flag. Non-owners never send it.
- `POST /api/dashboards/import` stores a bad breakpoint repaired (reflowed at its own column count) instead of
  rejecting it with 400.
- The dashboard payload's existing `ownerId` field is declared on the frontend `Dashboard` type.

## Capabilities

### New Capabilities
- `stored-layout-repair`: owner-only repair of stored-bad breakpoints on open, its endpoint contract, and its
  non-owner and idempotency guarantees.

### Modified Capabilities
- `breakpoint-layout-resolution`: "Derived and repaired layouts persist only on an edit at that breakpoint" gains the
  owner-on-open exception for stored-bad breakpoints.
- `dashboard-layout-validation`: import no longer 400s on a bad breakpoint; it stores it repaired.

## Non-goals

- Fixing the pre-existing gap where a Text panel create adds no server-side layout item (HEL-1230 finding).
- Persisting derived layouts for breakpoints that are merely missing panels (still render-time only).
- Any repair by non-owners, editors, public/share-token viewers, or MCP/agent writes.
- A bulk maintenance job over all dashboards.

## Impact

- Backend: `DashboardService`, `DashboardServiceValidation`, `DashboardRoutes`, `DashboardRepository` (unpaged panel-id
  read, layout-only compare-and-set write); no new schema file, no migration.
- Frontend: `dashboardsSlice`, `dashboardService`, a repair hook mounted by `PanelGrid` (documented exception to the
  HEL-301 phone-width no-write guarantee), `useLayoutSave.ts` contract header, `features/layout/README.md`, dashboard
  type, audit `actionLabels.ts`.
- Shared seam fixture under `shared-test-fixtures/`.
