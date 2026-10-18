// outputSchemaPanelPlacement -- HEL-1668 D4: where the output schema panel opens, decided from its REAL rendered size
// (measured width, content height) and from its CSS-declared limits, never from literal pixel copies of the CSS.
import type { PortalPopoverPos } from "../../../hooks/usePortalPopover";

/** Gap between the trigger and the panel. */
const TRIGGER_GAP = 8;

interface PanelLimits {
  maxWidth: number;
  maxHeight: number;
  edgeMargin: number;
}

/** The panel's limits from the custom properties declared on `.output-schema-disclosure__panel`, in px. */
export function readPanelLimits(panel: HTMLElement): PanelLimits {
  const style = getComputedStyle(panel);
  const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const px = (name: string): number => {
    const value = style.getPropertyValue(name).trim();
    const n = parseFloat(value);
    if (Number.isNaN(n)) return 0;
    return value.endsWith("rem") ? n * rootFont : n;
  };
  return {
    maxWidth: px("--schema-panel-max-width"),
    maxHeight: px("--schema-panel-max-height"),
    edgeMargin: px("--schema-panel-edge-margin"),
  };
}

export interface PanelPlacementInput {
  trigger: { left: number; top: number; bottom: number };
  viewport: { width: number; height: number };
  /** The mounted panel's measured width. */
  panelWidth: number;
  /** The panel's content height (`scrollHeight`), unaffected by its `max-height`. */
  contentHeight: number;
  /** The CSS height cap. */
  maxHeight: number;
  edgeMargin: number;
  /** Top edge of the rendered bottom navigation, when it can cover the room below. */
  navTop: number | null;
}

/** Above when `min(content, cap)` fits above; otherwise the side with more room, height capped to that room. */
export function placeSchemaPanel(input: PanelPlacementInput): PortalPopoverPos {
  const { trigger, viewport, panelWidth, contentHeight, maxHeight, edgeMargin, navTop } = input;
  const left = Math.max(
    edgeMargin,
    Math.min(trigger.left, viewport.width - panelWidth - edgeMargin),
  );
  const roomAbove = trigger.top - TRIGGER_GAP - edgeMargin;
  const roomBelow = (navTop ?? viewport.height) - edgeMargin - trigger.bottom - TRIGGER_GAP;
  const needed = Math.min(contentHeight, maxHeight);
  if (needed <= roomAbove || roomAbove >= roomBelow) {
    return {
      bottom: viewport.height - trigger.top + TRIGGER_GAP,
      left,
      maxHeight: Math.max(0, Math.min(maxHeight, roomAbove)),
    };
  }
  return {
    top: trigger.bottom + TRIGGER_GAP,
    left,
    maxHeight: Math.max(0, Math.min(maxHeight, roomBelow)),
  };
}

/** Measures the mounted `panel` and places it against `trigger`. The bottom nav caps the room below on a page outside
 *  an open dialog (the step sheet covers the nav). */
export function placeMountedPanel(panel: HTMLElement, trigger: DOMRect): PortalPopoverPos {
  const limits = readPanelLimits(panel);
  const nav = panel.closest("dialog[open]") ? null : document.querySelector(".bottom-nav");
  const navRect = nav?.getBoundingClientRect();
  return placeSchemaPanel({
    trigger,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    panelWidth: panel.getBoundingClientRect().width,
    contentHeight: panel.scrollHeight,
    maxHeight: limits.maxHeight,
    edgeMargin: limits.edgeMargin,
    navTop: navRect && navRect.height > 0 ? navRect.top : null,
  });
}
