// Test fixtures for the CS2c-3c Panel discriminated union.
//
// Tests historically built panel literals using the flat-field shape. The
// helpers below construct typed-config panels by subtype with sensible
// defaults, accepting partial overrides for the per-test fields the test
// actually cares about.

import type {
  ChartPanel,
  ChartPanelConfig,
  CollectionPanel,
  CollectionPanelConfig,
  DividerPanel,
  DividerPanelConfig,
  ImagePanel,
  ImagePanelConfig,
  MarkdownPanel,
  MarkdownPanelConfig,
  MetricPanel,
  MetricPanelConfig,
  Panel,
  PanelAppearance,
  TablePanel,
  TablePanelConfig,
  TextPanel,
  TextPanelConfig,
} from "../features/panels/types/panel";
import type { ResourceMeta } from "../types/models";
const defaultMeta: ResourceMeta = {
  createdBy: "u1",
  createdAt: "2024-01-01T00:00:00Z",
  lastUpdated: "2024-01-01T00:00:00Z",
};

const defaultAppearance: PanelAppearance = {
  background: "#ffffff",
  color: "#000000",
  transparency: 1,
};

interface PanelBaseOverrides {
  id?: string;
  dashboardId?: string;
  title?: string;
  meta?: ResourceMeta;
  appearance?: PanelAppearance;
  ownerId?: string;
  refreshInterval?: number | null;
  /** HEL-234: ISO-8601 freshness timestamp; absent/null when panel is unbound. */
  dataAsOf?: string | null;
}

function applyBase<T extends Panel>(
  overrides: PanelBaseOverrides,
  type: T["type"],
  config: T["config"],
): T {
  return {
    id: overrides.id ?? "panel-1",
    dashboardId: overrides.dashboardId ?? "dashboard-1",
    title: overrides.title ?? "Test Panel",
    meta: overrides.meta ?? defaultMeta,
    appearance: overrides.appearance ?? defaultAppearance,
    ownerId: overrides.ownerId ?? "u1",
    refreshInterval: overrides.refreshInterval ?? null,
    dataAsOf: overrides.dataAsOf ?? null,
    type,
    config,
  } as T;
}

export function makeMetricPanel(
  overrides: PanelBaseOverrides & { config?: Partial<MetricPanelConfig> } = {},
): MetricPanel {
  const config: MetricPanelConfig = {
    dataTypeId: overrides.config?.dataTypeId ?? "",
    fieldMapping: overrides.config?.fieldMapping ?? {},
    aggregation: overrides.config?.aggregation,
    label: overrides.config?.label,
    unit: overrides.config?.unit,
  };
  return applyBase<MetricPanel>(overrides, "metric", config);
}

export function makeChartPanel(
  overrides: PanelBaseOverrides & { config?: Partial<ChartPanelConfig> } = {},
): ChartPanel {
  const config: ChartPanelConfig = {
    dataTypeId: overrides.config?.dataTypeId ?? "",
    fieldMapping: overrides.config?.fieldMapping ?? {},
    aggregation: overrides.config?.aggregation,
    chartOptions: overrides.config?.chartOptions,
  };
  return applyBase<ChartPanel>(overrides, "chart", config);
}

export function makeTablePanel(
  overrides: PanelBaseOverrides & { config?: Partial<TablePanelConfig> } = {},
): TablePanel {
  const config: TablePanelConfig = {
    dataTypeId: overrides.config?.dataTypeId ?? "",
    fieldMapping: overrides.config?.fieldMapping ?? {},
    columnWidths: overrides.config?.columnWidths,
  };
  return applyBase<TablePanel>(overrides, "table", config);
}

export function makeTextPanel(
  overrides: PanelBaseOverrides & { config?: Partial<TextPanelConfig> } = {},
): TextPanel {
  const config: TextPanelConfig = {
    content: overrides.config?.content ?? "",
    dataTypeId: overrides.config?.dataTypeId ?? "",
    fieldMapping: overrides.config?.fieldMapping ?? {},
  };
  return applyBase<TextPanel>(overrides, "text", config);
}

export function makeMarkdownPanel(
  overrides: PanelBaseOverrides & { config?: Partial<MarkdownPanelConfig> } = {},
): MarkdownPanel {
  const config: MarkdownPanelConfig = {
    content: overrides.config?.content ?? "",
    dataTypeId: overrides.config?.dataTypeId ?? "",
    fieldMapping: overrides.config?.fieldMapping ?? {},
  };
  return applyBase<MarkdownPanel>(overrides, "markdown", config);
}

export function makeImagePanel(
  overrides: PanelBaseOverrides & { config?: Partial<ImagePanelConfig> } = {},
): ImagePanel {
  const config: ImagePanelConfig = {
    imageUrl: overrides.config?.imageUrl ?? "",
    imageFit: overrides.config?.imageFit ?? "contain",
  };
  return applyBase<ImagePanel>(overrides, "image", config);
}

export function makeDividerPanel(
  overrides: PanelBaseOverrides & { config?: Partial<DividerPanelConfig> } = {},
): DividerPanel {
  const config: DividerPanelConfig = {
    orientation: overrides.config?.orientation ?? "horizontal",
    weight: overrides.config?.weight,
    color: overrides.config?.color,
  };
  return applyBase<DividerPanel>(overrides, "divider", config);
}

export function makeCollectionPanel(
  overrides: PanelBaseOverrides & { config?: Partial<CollectionPanelConfig> } = {},
): CollectionPanel {
  const config: CollectionPanelConfig = {
    dataTypeId: overrides.config?.dataTypeId ?? "",
    fieldMapping: overrides.config?.fieldMapping ?? {},
    baseType: overrides.config?.baseType ?? "metric",
    layout: overrides.config?.layout ?? "grid",
    itemOptions: overrides.config?.itemOptions,
  };
  return applyBase<CollectionPanel>(overrides, "collection", config);
}
