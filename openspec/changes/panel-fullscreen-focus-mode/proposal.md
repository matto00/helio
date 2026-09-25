## Why

Panels are confined to their grid cell with no way to expand one for a closer look. `PanelDetailModal`'s
view mode (`panel-view-mode` capability) already maximizes content within its own edit/inspect surface,
but that surface still carries Edit/Rename/tab machinery. HEL-584 adds a dedicated, view-only fullscreen
overlay reachable straight from the grid, distinct from that modal.

## What Changes

- Add a "Fullscreen" `IconButton` to `PanelCard`'s header (alongside HEL-579's Refresh control), opening
  the panel's content in a maximized `Modal size="full"` overlay.
- The overlay reuses `PanelContent` unmodified, fed the SAME `usePanelData(panel)` result `PanelCard`
  already holds (no second fetch instance — HEL-579 design.md Decision 1 must not be defeated).
- Overlay header: panel title + mono eyebrow context; close via `Esc`/backdrop/close button (all native
  `Modal` behavior — no new focus-trap/backdrop/animation code).
- Covers `output` panels (chart/table/metric/markdown/collection/timeline sub-kinds), `text`, `markdown`,
  and `image`. Excludes `divider` (no content to maximize) and `form` (a write surface — view-only
  overlay is the wrong place to submit data); the header control does not render for those two kinds.
- `MobilePanelStack` does not gain a fullscreen control — it is documented read-only/no-header-actions
  today and its single-column layout already approximates "maximized."

## Capabilities

### New Capabilities
- `panel-fullscreen`: keyboard-accessible fullscreen/focus-mode overlay for a single panel, opened from
  `PanelCard`, view-only, reusing existing content renderers and the shared `Modal` primitive.

### Modified Capabilities
(none — no existing capability's requirements change; `panel-manual-refresh`'s `usePanelData` contract is
consumed, not altered)

## Impact

- `frontend/src/features/panels/ui/PanelCard.tsx` — new header `IconButton` + overlay mount.
- New `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx` (or similar) wrapping `Modal` +
  `PanelContent`.
- New `frontend/src/features/panels/ui/PanelFullscreenOverlay.css` — the definite-height override
  (`.panel-fullscreen-overlay { height: min(90vh, 1000px); overflow: hidden; }`, design.md Decision 1a)
  `Modal size="full"` needs to actually fill, mirroring `PanelDetailModal.css`'s `--view` height rule for
  its own `size="full"` usage.
- No backend/schema changes.
