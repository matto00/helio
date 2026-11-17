## Why

On phone dashboards a vertical drag that starts on a Table header's column-resize handle was reported not to scroll the page, because the handle is `touch-action: none`, which by spec should stop the browser from starting a native pan. That behaviour did not reproduce in Chromium real-touch emulation (8/8 drags scrolled) and is untested on iOS WebKit. The handles sit on every column edge, including near the screen centre at 375px, where a thumb drags. Touch resize was never implemented (the resize gesture is mouse-driven), so the blocking `touch-action` buys a phone user nothing. It was reported as the root cause of the HEL-1682 flake. The owner ruled to ship `pan-y` as a defensive change with a guard test (escalation answer `ship-pan-y-as-guard`).

## What Changes

- The column-resize handle lets vertical touch pans through to native scrolling (`touch-action: pan-y`), at every width. Mouse resize (desktop) and the keyboard nudge are unchanged; horizontal pen drags keep reaching the mouse-driven resize.
- New GUARD e2e (not failing-first proof; the owner dropped that AC): at 375x812 and 430x932 with real touch input, the handle's computed `touch-action` permits vertical panning, and a vertical drag starting on a resize handle (and on plain header text) scrolls the page; a desktop mouse drag on a handle still resizes the column. Each guard is shown failable by mutation.
- The capped Table body case (Table panels are `output` panels; the card's `.mobile-panel-stack__item--output .panel-content` is capped at 60dvh and the DataGrid's own `.ui-data-grid` inside it is the vertical scroller, sticky header included) is triaged with real touch input and either fixed or documented as the intended nested-scroll behaviour (body scrolls to its bound, then the page).
- The dead `.mobile-panel-stack__item--table .panel-content--table` cap rule in MobilePanelStack.css is deleted (`table` is not a `PanelKind`; the stack class is `--${panel.type}`) after a grep proves nothing renders that class, and `mobilePanelHeights.ts`'s citation is repointed at the live cap. The intrinsic-kind selector list is left as is.
- `e2e/hel1656-pull-to-refresh.spec.ts`'s comment that cites the handle as `touch-action: none` is corrected.

## Capabilities

### New Capabilities

### Modified Capabilities

- `mobile-viewer-stack`: adds a requirement that a vertical touch drag starting on a Table header (including a column-resize handle) pans the page on the phone stack, and states the capped Table body's nested-scroll behaviour.

## Impact

- `frontend/src/features/panels/ui/grid/MobilePanelStack.css` and `mobilePanelHeights.ts` (comment): dead `--table` cap rule removed, citation repointed.
- `frontend/src/shared/ui/DataGrid.css` (one property on `.ui-data-grid__resize-handle`), shared by every full-variant DataGrid (Table panels, Output editor tables); touch-only effect.
- New e2e spec under `e2e/`; small comment fix in `e2e/hel1656-pull-to-refresh.spec.ts`.
- No backend, schema, or API change.
