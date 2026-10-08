/** Gap kept between the listbox and the viewport edge / its trigger. */
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 4;

/** Mirrors `.ui-select__panel { max-height }` in inputs.css. */
export const SELECT_PANEL_MAX_HEIGHT = 280;

export interface SelectPanelFit {
  top: number;
  maxHeight: number;
}

/** Where a fixed-position Select listbox must sit so every option is reachable inside the
 *  viewport. The panel opens below its trigger by default; when it would run past the bottom edge
 *  it opens above instead if that side has more room, and in either case its height is capped to
 *  the room available so the rest scrolls inside the listbox. `naturalHeight` is the full height
 *  the panel wants (content plus chrome), independent of any cap applied earlier. */
export function fitSelectPanel(
  trigger: { top: number; bottom: number },
  naturalHeight: number,
  viewportHeight: number,
): SelectPanelFit {
  const height = Math.min(naturalHeight, SELECT_PANEL_MAX_HEIGHT);
  const below = viewportHeight - (trigger.bottom + TRIGGER_GAP) - VIEWPORT_MARGIN;
  if (height <= below) return { top: trigger.bottom + TRIGGER_GAP, maxHeight: height };
  const above = trigger.top - TRIGGER_GAP - VIEWPORT_MARGIN;
  if (above > below) {
    const fitted = Math.max(Math.min(height, above), 0);
    return { top: trigger.top - TRIGGER_GAP - fitted, maxHeight: fitted };
  }
  return { top: trigger.bottom + TRIGGER_GAP, maxHeight: Math.max(below, 0) };
}
