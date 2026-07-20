import type { PanelType } from "../types/panel";
export interface PanelSlot {
  key: string;
  label: string;
}

export const PANEL_SLOTS: Record<PanelType, PanelSlot[]> = {
  metric: [
    { key: "value", label: "Value" },
    { key: "label", label: "Label" },
    { key: "unit", label: "Unit" },
  ],
  chart: [
    { key: "xAxis", label: "X Axis" },
    { key: "yAxis", label: "Y Axis" },
    { key: "series", label: "Series" },
  ],
  // HEL-255: the vestigial "columns" fieldMapping slot (rendering never read
  // it) is superseded by the Table display controls (`TableDisplayFields`).
  table: [],
  text: [{ key: "content", label: "Content" }],
  markdown: [],
  image: [],
  divider: [],
  // HEL-247: a collection has no slots of its own — the editor derives its
  // shared item slots from `PANEL_SLOTS[baseType]` (e.g. `PANEL_SLOTS.metric`)
  // instead, so a new base type never needs an entry here.
  collection: [],
  // HEL-317: two bound slots — a time/order field and a text/event field —
  // both read directly by `TimelineRenderer` per entry.
  timeline: [
    { key: "time", label: "Time" },
    { key: "event", label: "Event" },
  ],
};
