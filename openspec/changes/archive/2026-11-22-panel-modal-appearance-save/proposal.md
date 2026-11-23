## Why

HEL-1615 suspects that saving the panel detail modal silently resets a panel's stored `appearance.chart` (chart type and
settings) or background, because the modal's batched `updateBatch` write sends only background/color/transparency. The
server has merged appearance patches since HEL-362, but the client's optimistic state update replaces the local
appearance object wholesale, so a loss could still surface in the browser (or reach the server through a later write).
Nobody has measured it.

## What Changes

- Probe the real path on a lane backend (API and Playwright through the modal, every saving section): before/after
  panel JSON from the server AND the client-rendered result, committed as evidence.
- If any appearance field the user did not edit changes (server-stored or client-visible), fix it at the write seam
  with a red-first test. Expected seam: the client accumulator merging the appearance patch over the stored appearance
  instead of replacing it. No server API semantic change is planned (already merge).
- If nothing is lost anywhere, add a guard test that pins the preservation behaviour and close with evidence.
- Add a `panel-detail-modal` requirement: saving the modal preserves appearance fields it does not edit.

## Capabilities

### New Capabilities

### Modified Capabilities
- `panel-detail-modal`: adds the requirement that a modal save preserves unedited appearance fields (`chart`,
  untouched background/color/transparency) both on the server and in the client's state.

## Impact

- Frontend: `frontend/src/features/panels/state/panelsSlice.ts` (accumulator), possibly
  `ui/detailModal/PanelDetailModal.tsx`; their tests; a Playwright spec.
- Backend: read-only for the probe; at most a guard spec on the batch merge path. No migration, no API change.
- MCP `update_panel_appearance`/`update_panel` and other `updateBatch`/PATCH callers: unaffected (server unchanged).

## Non-goals

- Changing the documented PATCH/updateBatch appearance semantics (already merge; any change escalates first).
- Adding chart-appearance editing UI to the modal.
- Touching HEL-1585 (app shell scroll) or HEL-1625 (pipeline analyze) files.
