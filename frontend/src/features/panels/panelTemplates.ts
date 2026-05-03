import type { PanelType } from "../../types/models";

export interface PanelTemplate {
  id: string;
  label: string;
  description: string;
  defaults: {
    title: string;
  };
}

/**
 * Hardcoded starter templates per panel type (v1.2).
 * Each type ships with 2-3 presets. Selecting a template pre-fills the panel
 * title in the creation modal. The null sentinel ("Start blank") bypasses
 * pre-fill entirely - see handleTemplateSelect in PanelCreationModal.
 */
export const PANEL_TEMPLATES: Record<PanelType, PanelTemplate[]> = {
  metric: [
    {
      id: "metric-kpi",
      label: "KPI Metric",
      description: "Display a single value with a descriptive label",
      defaults: { title: "KPI Metric" },
    },
    {
      id: "metric-percentage-change",
      label: "Percentage Change",
      description: "Show a value with a delta indicator",
      defaults: { title: "Percentage Change" },
    },
  ],
  chart: [
    {
      id: "chart-timeseries-line",
      label: "Time-series Line Chart",
      description: "Basic line chart showing trends over time",
      defaults: { title: "Time-series Line Chart" },
    },
    {
      id: "chart-trend-overview",
      label: "Trend Overview",
      description: "Area chart for a high-level trend summary",
      defaults: { title: "Trend Overview" },
    },
  ],
  text: [
    {
      id: "text-section-header",
      label: "Section Header",
      description: "Large heading for labeling a dashboard section",
      defaults: { title: "Section Header" },
    },
    {
      id: "text-description-block",
      label: "Description Block",
      description: "Body text for context or instructions",
      defaults: { title: "Description Block" },
    },
  ],
  table: [
    {
      id: "table-data-summary",
      label: "Data Summary Table",
      description: "Compact table for summarised data",
      defaults: { title: "Data Summary Table" },
    },
    {
      id: "table-full-grid",
      label: "Full Data Grid",
      description: "Expanded columns for detailed row-level data",
      defaults: { title: "Full Data Grid" },
    },
  ],
  markdown: [
    {
      id: "markdown-document",
      label: "Markdown Document",
      description: "Rich formatted content using Markdown syntax",
      defaults: { title: "Markdown Document" },
    },
    {
      id: "markdown-quick-notes",
      label: "Quick Notes",
      description: "Simple notes panel with basic Markdown support",
      defaults: { title: "Quick Notes" },
    },
  ],
  image: [
    {
      id: "image-display",
      label: "Image Display",
      description: "Embed and display an image from a URL",
      defaults: { title: "Image Display" },
    },
    {
      id: "image-banner",
      label: "Banner Image",
      description: "Wide banner image for branding or decoration",
      defaults: { title: "Banner Image" },
    },
  ],
  divider: [
    {
      id: "divider-section",
      label: "Section Divider",
      description: "Horizontal line to visually separate sections",
      defaults: { title: "Section Divider" },
    },
    {
      id: "divider-labeled",
      label: "Labeled Divider",
      description: "Divider paired with a short section label",
      defaults: { title: "Labeled Divider" },
    },
  ],
};
