## Why

A tab that creates or duplicates its own panel ends up holding a stale `layoutVersion`: the placement response carries
the placed items but not the version the V127 trigger just assigned, so the tab's next layout save always takes a 409,
a silent rebase and a retry (one extra round trip plus a dashboard refetch). See ticket.md.

## What Changes

- `POST /api/panels` and `POST /api/panels/:id/duplicate` responses gain `layoutVersion`: the dashboard's stored
  layout version right after the placement committed, read in the same transaction that appended the items.
- `POST /api/panels/batch` response gains a top-level `layoutVersion` (one placement transaction, one version) when
  at least one panel was created.
- The web client's create and duplicate flows hand that version to the layout baseline. The baseline version advances
  to it only when it is exactly one more than the version the baseline was derived from (proof that the placement was
  the only layout write in between); otherwise nothing changes and the existing 409-and-rebase path runs.
- `schemas/panels/panel.schema.json` and `schemas/panels/create-panels-batch-response.schema.json` document the field.
- Additive only: no field removed or renamed; no migration.

## Capabilities

### New Capabilities

### Modified Capabilities
- `dashboard-layout-concurrency`: placement responses expose the new layout version, and the web client adopts it
  only when it is consecutive to its baseline version.

## Impact

- Backend: panel placement persistence (`PanelLayoutPlacement`, `PanelMutationOps`), `PanelService`/lifecycle/batch
  writes, `PanelRoutes.placedResponse`, `PanelProtocol` / batch response protocol.
- Frontend: `panelThunks.ts` (`createPanel`, `duplicatePanel`), `panelPlacement.ts`, `dashboardsSlice.ts`
  (`setDashboardLayoutLocally`), `useLayoutSave.ts`, panel types.
- helio-mcp: untouched; its batch response type gains an optional field it ignores (noted in the PR body for HEL-1524).

## Non-goals

- `DELETE /api/panels/:id` stays 204 with no body; its version bump keeps the existing 409-and-rebase path (follow-up).
- Patch-set apply/undo, auto-layout and contents replace already return a dashboard; unchanged.
- No change to the V127 trigger or any migration; no helio-mcp edits.
