import type { PanelType } from "../../types/models";

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
  table: [{ key: "columns", label: "Columns" }],
  text: [{ key: "content", label: "Content" }],
  markdown: [],
};
