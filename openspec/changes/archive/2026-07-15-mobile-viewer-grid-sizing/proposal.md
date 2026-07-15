## Why

The mobile PWA (HEL-300 shipped the shell) is unusable as a dashboard *viewer*: below 768px the React Grid
Layout grid renders desktop-proportioned panels (`h × 52px` heights leave metric panels ~80% whitespace), and —
critically — merely opening a dashboard on a phone can fire `onLayoutChange` → the auto-save pipeline →
`PATCH /api/dashboards/:id`, silently corrupting the stored `xs` layout for every client (hazard §4.1 of
`notes/mobile-pwa-handoff.md`, the binding spec). This ticket (HEL-301) is the primary deliverable of the
mobile project: sizing that feels native, on a path structurally incapable of writing layouts back.

## What Changes

- Below the grid's `sm` container-width boundary (768px — where RGL would otherwise resolve the `xs` layout),
  `PanelGrid` no longer renders `<Responsive>` at all. It renders a single-column, read-only stack of
  `PanelCard`s ordered by the stored `xs` layout (`y`, then `x`). The stack has no code path to
  `markLayoutChanged`/`usePanelGridSave`, so layout write-back from phone is structurally impossible.
- Per-kind panel heights in the stack (handoff W4.3): metric content-sized (~104–132px, ignore `h`); chart
  aspect-driven `clamp(200px, w × 0.62, 340px)` modulated by `h`; table capped at `min(60dvh, content)` with
  internal scroll; text/markdown fully intrinsic; image natural aspect; divider bare hairline. Never `h × 52`.
- Phone density/chrome at the ratified 430px breakpoint (W4.4): `--space-3` gutters, footer type badge and
  drag affordances dropped, zoom widget hidden, metric typography from the `DESIGN.md` type scale.
- Renderer hardening at phone widths (W5): table scrolls horizontally inside its panel (body never scrolls
  sideways), ECharts resizes on rotation with legend/axis overflow handled via config, markdown/text/image
  never force body scroll.
- `PanelDetailModal` full-screen on phone, dismissible without hover targets.
- Stored layout contract untouched: `dashboardGridCols.xs` stays `2`; no backend or `schemas/` changes.

## Capabilities

### New Capabilities

- `mobile-viewer-stack`: read-only single-column panel stack below the `sm` grid boundary; structural
  guarantee of no layout persistence from that path; `xs`-layout ordering.
- `mobile-panel-sizing`: per-kind content-appropriate panel heights and phone density/chrome/renderer
  behavior below the ratified phone breakpoint.

### Modified Capabilities

- `dashboard-chrome-zoom-widget`: widget is hidden below the phone breakpoint (430px).
- `panel-detail-modal`: modal becomes full-screen on phone and is dismissible without a hover target.

## Impact

- Frontend only: `PanelGrid.tsx`, `panelGridConfig.ts` (helpers), new stack component + CSS,
  `PanelList.tsx`/`.css` (zoom widget), `PanelCard`/`PanelContent` chrome CSS, `PanelDetailModal.css`,
  `features/panels/ui/renderers/*` and `DataGrid.css`.
- No backend, no `schemas/`, no API contract changes. Navigation (HEL-302) untouched.
- Terminal state is "ready for device testing": the two decisive checks (layout-corruption byte-identity,
  one-of-every-kind sizing) are human-performed on a physical iPhone per handoff §6.

## Non-goals

- Navigation / tab bar / dashboard sheet (HEL-302), PWA shell (HEL-300, shipped).
- Panel editing of any kind on phone (drag, resize, title edit, delete, create).
- Changing the persisted layout contract or `dashboardGridCols`.
- Offline data, backend, `schemas/`.
- Desktop/iPad ≥768px behavior — must remain visually and behaviorally unchanged.
