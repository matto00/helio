// Type-narrowing helpers for the `Panel` discriminated union.
//
// Consumers that need a subtype-specific config field should narrow first
// (`if (isOutputPanel(panel)) { panel.config.outputId … }`) or use one of
// the accessors below for read-only convenience without explicit branches.
//
// HEL-909: the bound trio (metric/chart/table) and collection/timeline
// panel kinds are retired. `getDataTypeId`/`getFieldMapping`/
// `getMetricAggregation`/`getChartAggregation`/`getMetricLiteral` go with
// them — that data now lives on the fetched Output, not the placement.

import type {
  DividerOrientation,
  DividerPanel,
  ImageFit,
  ImagePanel,
  MarkdownPanel,
  OutputPanel,
  Panel,
  TextPanel,
} from "../types/panel";

export const isOutputPanel = (p: Panel): p is OutputPanel => p.type === "output";
export const isTextPanel = (p: Panel): p is TextPanel => p.type === "text";
export const isMarkdownPanel = (p: Panel): p is MarkdownPanel => p.type === "markdown";
export const isImagePanel = (p: Panel): p is ImagePanel => p.type === "image";
export const isDividerPanel = (p: Panel): p is DividerPanel => p.type === "divider";

/** Returns the placement's bound Output id, or `null` for a non-output panel
 *  or an unset placement. */
export function getOutputId(panel: Panel): string | null {
  if (!isOutputPanel(panel)) return null;
  const id = panel.config.outputId;
  return id.length > 0 ? id : null;
}

/** Returns text/markdown content, or `null` for other subtypes. */
export function getContent(panel: Panel): string | null {
  if (isTextPanel(panel) || isMarkdownPanel(panel)) {
    return panel.config.content;
  }
  return null;
}

/** Returns image URL for image panels, otherwise `null`. */
export function getImageUrl(panel: Panel): string | null {
  return isImagePanel(panel) ? panel.config.imageUrl : null;
}

/** Returns image fit for image panels, otherwise `null`. */
export function getImageFit(panel: Panel): ImageFit | null {
  if (!isImagePanel(panel)) return null;
  const fit = panel.config.imageFit;
  if (fit === "contain" || fit === "cover" || fit === "fill") return fit;
  return null;
}

/** Returns divider orientation for divider panels, otherwise `null`. */
export function getDividerOrientation(panel: Panel): DividerOrientation | null {
  if (!isDividerPanel(panel)) return null;
  const o = panel.config.orientation;
  if (o === "horizontal" || o === "vertical") return o;
  return null;
}

/** Returns divider weight (px) for divider panels, otherwise `null`. */
export function getDividerWeight(panel: Panel): number | null {
  if (!isDividerPanel(panel)) return null;
  return panel.config.weight ?? null;
}

/** Returns divider color for divider panels, otherwise `null`. */
export function getDividerColor(panel: Panel): string | null {
  if (!isDividerPanel(panel)) return null;
  return panel.config.color ?? null;
}
