import rects from "./rects.json";

export type Rect = [number, number, number, number];

export const PANEL_RECTS = rects.panels as Rect[];
const pct = (value: number, of: number) => `${(value / of) * 100}%`;

/** Positions `el` over a panel rectangle measured from the capture (identical on every example). */
export function placeOverPanel(el: HTMLElement, [x, y, w, h]: Rect): void {
  el.style.left = pct(x, rects.width);
  el.style.top = pct(y, rects.height);
  el.style.width = pct(w, rects.width);
  el.style.height = pct(h, rects.height);
}

/** The centre of a panel, as the percentage position the follow-up prompt is anchored to. */
export function panelCentre([x, y, w, h]: Rect): { left: string; top: string } {
  return { left: pct(x + w / 2, rects.width), top: pct(y + h / 2, rects.height) };
}
