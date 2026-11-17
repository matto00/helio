import { fitPanelVertically } from "./panelFit";

/** Gap kept between the listbox and its trigger. */
const TRIGGER_GAP = 4;

/** Mirrors `.ui-select__panel { max-height }` in inputs.css. */
export const SELECT_PANEL_MAX_HEIGHT = 280;

export interface SelectPanelFit {
  top: number;
  maxHeight: number;
}

/** Where a fixed-position Select listbox must sit so every option is reachable inside the viewport. The panel opens
 *  below its trigger by default; when it would run past the bottom edge it opens above instead if that side has more
 *  room, and in either case its height is capped to the room available so the rest scrolls inside the listbox.
 *  `naturalHeight` is the full height the panel wants (content plus chrome), independent of any cap applied earlier.
 *  The rule is the shared `fitPanelVertically`, preferring below. */
export function fitSelectPanel(
  trigger: { top: number; bottom: number },
  naturalHeight: number,
  viewportHeight: number,
): SelectPanelFit {
  const { top, maxHeight } = fitPanelVertically(trigger, naturalHeight, viewportHeight, {
    gap: TRIGGER_GAP,
    cap: SELECT_PANEL_MAX_HEIGHT,
    prefer: "below",
  });
  return { top, maxHeight };
}
