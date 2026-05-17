// ── Panel discriminated union (CS2c-3c wire shape) ──────────────────────────
//
// Mirrors the backend `domain/panels/*Panel.scala` ADT and the wire
// `{ type, config }` shape emitted by `PanelResponse.fromDomain` /
// `PanelConfigCodec.encodeConfig`.
//
// Every consumer that needs subtype-specific data MUST narrow on `panel.type`
// (or use a helper from `panelNarrowing.ts`) before reading `panel.config`.
// The pre-CS2c-3c flat nullable fields (`typeId`, `fieldMapping`, `content`,
// `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`,
// `dividerColor`) no longer exist at the root.

import type { PanelAppearance, ResourceMeta } from "./models";

export type PanelKind = "metric" | "chart" | "table" | "text" | "markdown" | "image" | "divider";

export type ImageFit = "contain" | "cover" | "fill";

export type DividerOrientation = "horizontal" | "vertical";

// ── Per-subtype config shapes ───────────────────────────────────────────────
//
// Field names mirror backend `domain/panels/<Subtype>PanelConfig`. The
// "bound trio" (metric/chart/table) all carry `dataTypeId` + `fieldMapping`;
// the backend emits `dataTypeId: ""` for unbound rows, so `isBound` checks
// must compare to a non-empty string rather than to `null`.

export interface MetricPanelConfig {
  dataTypeId: string;
  fieldMapping: Record<string, string>;
}

export interface ChartPanelConfig {
  dataTypeId: string;
  fieldMapping: Record<string, string>;
}

export interface TablePanelConfig {
  dataTypeId: string;
  fieldMapping: Record<string, string>;
}

export interface TextPanelConfig {
  content: string;
}

export interface MarkdownPanelConfig {
  content: string;
}

export interface ImagePanelConfig {
  imageUrl: string;
  imageFit: string;
}

export interface DividerPanelConfig {
  orientation: string;
  weight?: number | null;
  color?: string | null;
}

export type PanelConfig =
  | MetricPanelConfig
  | ChartPanelConfig
  | TablePanelConfig
  | TextPanelConfig
  | MarkdownPanelConfig
  | ImagePanelConfig
  | DividerPanelConfig;

// ── Discriminated union ─────────────────────────────────────────────────────
//
// Common fields live on `PanelBase`; each variant adds `type` + typed
// `config`. `refreshInterval` is a frontend-only field that the backend
// silently ignores on PATCH (no schema or column exists for it); it is
// preserved here so the `usePanelPolling` hook keeps working until CS3
// removes it. It is `null` for any panel hydrated from the backend.

interface PanelBase {
  id: string;
  dashboardId: string;
  title: string;
  meta: ResourceMeta;
  appearance: PanelAppearance;
  ownerId?: string;
  /** Frontend-only polling interval; not persisted by the backend. */
  refreshInterval?: number | null;
}

export interface MetricPanel extends PanelBase {
  type: "metric";
  config: MetricPanelConfig;
}

export interface ChartPanel extends PanelBase {
  type: "chart";
  config: ChartPanelConfig;
}

export interface TablePanel extends PanelBase {
  type: "table";
  config: TablePanelConfig;
}

export interface TextPanel extends PanelBase {
  type: "text";
  config: TextPanelConfig;
}

export interface MarkdownPanel extends PanelBase {
  type: "markdown";
  config: MarkdownPanelConfig;
}

export interface ImagePanel extends PanelBase {
  type: "image";
  config: ImagePanelConfig;
}

export interface DividerPanel extends PanelBase {
  type: "divider";
  config: DividerPanelConfig;
}

export type Panel =
  | MetricPanel
  | ChartPanel
  | TablePanel
  | TextPanel
  | MarkdownPanel
  | ImagePanel
  | DividerPanel;

// Legacy alias — `PanelType` was the discriminator string literal union under
// the pre-CS2c-3c flat shape. Same set as `PanelKind`; kept as an alias so
// existing consumers (e.g. `PanelContent` props, `PanelCreationModal`) need
// not rename.
export type PanelType = PanelKind;

// ── Default config factories ────────────────────────────────────────────────
//
// Used by `panelPayloads.ts` to build a typed `config` for create requests
// when the caller supplies no subtype-specific configuration.

export const emptyMetricConfig = (): MetricPanelConfig => ({
  dataTypeId: "",
  fieldMapping: {},
});

export const emptyChartConfig = (): ChartPanelConfig => ({
  dataTypeId: "",
  fieldMapping: {},
});

export const emptyTableConfig = (): TablePanelConfig => ({
  dataTypeId: "",
  fieldMapping: {},
});

export const emptyTextConfig = (): TextPanelConfig => ({ content: "" });

export const emptyMarkdownConfig = (): MarkdownPanelConfig => ({ content: "" });

export const emptyImageConfig = (): ImagePanelConfig => ({
  imageUrl: "",
  imageFit: "contain",
});

export const emptyDividerConfig = (): DividerPanelConfig => ({
  orientation: "horizontal",
});

export function emptyConfigForKind(kind: PanelKind): PanelConfig {
  switch (kind) {
    case "metric":
      return emptyMetricConfig();
    case "chart":
      return emptyChartConfig();
    case "table":
      return emptyTableConfig();
    case "text":
      return emptyTextConfig();
    case "markdown":
      return emptyMarkdownConfig();
    case "image":
      return emptyImageConfig();
    case "divider":
      return emptyDividerConfig();
  }
}
