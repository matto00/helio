## Why

In the phone panel stack (and the single-column stack at 768 px and at 1100 px with the sidebar open) a compact
counter form card collapses to 30-42 px: only its title shows, and the value, the `+`/`-` buttons and a non-owner's
"Your net change this session" caption sit inside a 24 px internal scroller. A one-tap control that has to be
scrolled into view is unusable on the device it exists for. The defect predates HEL-1788 and hits owners and editors.

## What Changes

- The `form` panel kind joins the stack's intrinsic-height kinds: its card sizes to its content in the mobile stack
  instead of resolving `.panel-grid-card`'s `height: 100%` / size containment to almost nothing (hypothesis, to be
  probe-confirmed before any fix, see design.md).
- A form body in the stack has no internal vertical scroller (it flows with the page, like text/markdown).
- The fix is scoped to selectors that match only form cards in the stack, so every other kind keeps its height;
  that is measured before and after, per kind.
- A Playwright spec that fails first, at 390/768/1100 (sidebar open), light and dark, owner and editor.

## Capabilities

### New Capabilities

### Modified Capabilities
- `mobile-panel-sizing`: the per-kind stack height policy gains an explicit `form` entry (fully intrinsic, no
  internal scroll).

## Impact

- Frontend CSS only, expected in `frontend/src/features/panels/ui/grid/MobilePanelStack.css` (and possibly
  `CounterControl.css`); no shared `Crossfade.css`/`PanelContent.css` rule change unless the probe forces it.
- New e2e spec under `e2e/`; possibly a `MobilePanelStack.css.test.ts` assertion.
- No backend, schema or migration change.

## Non-goals

- Desktop grid form sizing; multi-field form layout redesign; counter behaviour or caption copy.
- Files owned by in-flight HEL-1649 (phone contrast/hover) and HEL-1697 (draft evaluator).
