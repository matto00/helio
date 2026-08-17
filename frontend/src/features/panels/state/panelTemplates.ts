import type { PanelType } from "../types/panel";
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
export const PANEL_TEMPLATES: Partial<Record<PanelType, PanelTemplate[]>> = {
  metric: [
    {
      id: "metric-kpi",
      label: "KPI Metric",
      description: "Display a single value with a descriptive label",
      defaults: { title: "KPI Metric" },
    },
    {
      id: "metric-percentage-change",
      // F-117 — was "Show a value with a delta indicator", overpromising: a
      // trend indicator is a real MetricRenderer feature, but it's bound via
      // `fieldMapping.trend` in the editor, not configured by this template
      // (which, like every template here, only pre-fills the title).
      label: "Percentage Change",
      description: "Starter title for a metric that highlights a change over time",
      defaults: { title: "Percentage Change" },
    },
  ],
  chart: [
    {
      // F-117 — was "Basic line chart showing trends over time", implying
      // the chart type is already set; it isn't (chart type is picked on the
      // very next step). Both chart templates here only pre-fill the title.
      id: "chart-timeseries-line",
      label: "Time-series Line Chart",
      description: "Starter title for a trend chart — pick a chart type next",
      defaults: { title: "Time-series Line Chart" },
    },
    {
      id: "chart-trend-overview",
      label: "Trend Overview",
      description: "Starter title for a high-level trend summary — pick a chart type next",
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
      // F-117 — was "Compact table for summarised data" / "Expanded columns
      // for detailed row-level data", implying distinct column layouts;
      // neither template configures columns (only the title).
      id: "table-data-summary",
      label: "Data Summary Table",
      description: "Starter title for a compact summary table",
      defaults: { title: "Data Summary Table" },
    },
    {
      id: "table-full-grid",
      label: "Full Data Grid",
      description: "Starter title for a detailed, row-level data table",
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
  collection: [
    {
      id: "collection-metric-grid",
      label: "Metric Collection",
      description: "One metric tile per row of a data type",
      defaults: { title: "Metric Collection" },
    },
  ],
};
