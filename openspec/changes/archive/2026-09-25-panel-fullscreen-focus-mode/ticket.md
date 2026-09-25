# HEL-584: Panel fullscreen / focus mode

## Description

Panels are confined to their grid cell; there is no way to expand one to fill the viewport for a closer look or a presentation. A `PanelDetailModal` exists but it is the edit/inspect surface, not a clean full-viewport render. This ticket adds a fullscreen/focus mode that maximizes a single panel's rendered content.

## Scope

* Add a "Fullscreen"/focus action to `PanelCard` (header icon-button and/or `ActionsMenu` item) that opens the panel's rendered content (chart/metric/table/markdown/image) in a maximized overlay.
* Build the overlay on the shared `Modal` `lg` size or a dedicated full-viewport overlay following §6 conventions (opaque `--app-surface-strong`, `--app-overlay` backdrop, one entrance animation §3, focus trap, `Esc` to close, restore focus §8). Reuse the existing panel content renderers (`PanelContent`/`ChartPanel`/etc.) so the fullscreen render matches the card — do not fork rendering.
* The chart should re-fit to the larger size (ECharts resize on open/resize). Keep tooltips/hover (tooltips ticket) working in fullscreen; if drill-down has landed, keep it working too.
* Provide a title/header (panel name, mono eyebrow context) and a close control; no editing controls (focus mode is view-only — editing stays in `PanelDetailModal`).

## Acceptance criteria

* A keyboard-accessible Fullscreen control opens the panel content maximized; ECharts re-fits to the larger viewport; `Esc`/close returns and restores focus.
* Overlay uses shared Modal/overlay tokens (opaque surface, backdrop, single entrance, focus trap); correct in light/dark; respects `prefers-reduced-motion`.
* Rendering reuses existing panel renderers (no forked chart/table code); tooltips still work; content matches the card.
* Render/interaction test for open/close/focus + resize call; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* Editing within fullscreen (stays in `PanelDetailModal`).
* Presentation/slideshow across multiple panels.

## Dependencies

None. Coexists with the tooltips and drill-down tickets (fullscreen should preserve those interactions).

## Premise-validation notes (orchestrator, Setup)

Full evidence: `.concertino/runs/HEL-584/evidence/premise-validation.md` (verdict: minor-staleness). Key corrections Planning must apply:

* The ticket's panel-kind list ("chart/metric/table/markdown/image") is pre-remodel (HEL-903) terminology. The live `PanelKind` union is `"output" | "text" | "markdown" | "image" | "divider" | "form"`; chart/table/metric/markdown/collection/timeline are sub-kinds dispatched inside `OutputPanelContent` on the bound Output's `kind`. `text`, `divider`, and `form` (v0.8, HEL-1085/1087) postdate this ticket and aren't mentioned — Planning must decide and justify fullscreen's coverage of each explicitly (a `form` write-surface and a `divider` with no real content are both candidates for exclusion).
* `PanelDetailModal.tsx` already renders `<Modal size={modalMode === "view" ? "full" : "md"}>` — a shipped, light/dark-verified precedent for "maximize panel content via the shared Modal primitive." Prefer `Modal size="full"` over a bespoke full-viewport overlay unless a concrete reason rules it out; `Modal` already supplies the opaque surface, backdrop, entrance animation (already `prefers-reduced-motion`-safe via theme.css's global rule), focus trap, `Esc`-close, and focus restore this ticket asks for.
* HEL-579 (merged, `572dc8d6`) moved the sole `usePanelData(panel)` call to `PanelCard`; a fullscreen overlay must consume that same result as props (never call `usePanelData` a second time), or it risks racing HEL-579's in-flight refresh guard.
* `ChartPanel.tsx`'s `<ReactECharts autoResize={true}>` already self-observes its container and calls `chart.resize()` — reusing it unmodified inside a differently-sized overlay is expected to already re-fit; this needs verification, not new resize-wiring, unless evidence shows otherwise.
* `MobilePanelStack.tsx` is documented read-only, "no header actions" today — Planning must decide deliberately whether fullscreen appears there at all (driver's brief flags this as an open call).
