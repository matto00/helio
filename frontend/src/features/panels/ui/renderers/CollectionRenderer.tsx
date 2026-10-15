import "./CollectionRenderer.css";
import type { MappedPanelData } from "../../types/panel";
import type { MetricFormat } from "../../../pipelines/ui/outputEditor/outputConfigTypes";
import { MetricRenderer } from "./MetricRenderer";
import type { ConditionalFormatRule } from "./conditionalFormatting";

interface CollectionRendererProps {
  /** Bound-column mapping from the Output's `CollectionOutputConfig`. */
  fieldMapping: Record<string, string>;
  layout: "grid" | "list";
  /** `baseType: metric` items' numeric display style (HEL-876) — forwarded
   *  to each item's `MetricRenderer` unchanged. */
  format?: MetricFormat | null;
  /** Fetched snapshot rows (string cells, aligned to `headers`) — one row per
   *  rendered item, the table fetch path. */
  rawRows?: string[][] | null;
  /** Column names aligned to each `rawRows` row. */
  headers?: string[] | null;
  /** HEL-1307 -- threshold rules; each item evaluates them against its own raw value. */
  conditionalFormats?: ConditionalFormatRule[] | null;
}

/** Map one fetched row to a metric item's `MappedPanelData` (HEL-247 D4).
 *  Each `fieldMapping` slot (value/label/unit) resolves to that row's cell for
 *  the mapped column. */
function buildMetricItem(
  row: string[],
  headers: string[],
  fieldMapping: Record<string, string>,
): MappedPanelData {
  const item: MappedPanelData = {};
  for (const [slot, column] of Object.entries(fieldMapping)) {
    const idx = headers.indexOf(column);
    item[slot] = idx >= 0 ? (row[idx] ?? "") : "";
  }
  return item;
}

/** Collection body — expands one bound row into one homogeneous item (HEL-247).
 *  v1 ships the `metric` base type only: each item reuses `MetricRenderer` so it
 *  gets the exact Metric visual language. Grid layout wraps responsively (no
 *  horizontal overflow at 390px); list layout is a single divided column. */
export function CollectionRenderer({
  fieldMapping,
  layout,
  format,
  rawRows,
  headers,
  conditionalFormats,
}: CollectionRendererProps) {
  // Bound but no rows → "No data" state rather than an empty body.
  if (!rawRows || rawRows.length === 0 || !headers) {
    return (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">No data</span>
      </div>
    );
  }

  return (
    <div className={`panel-content panel-content--collection panel-content--collection-${layout}`}>
      {rawRows.map((row, index) => (
        <div key={index} className="panel-content__collection-item">
          <MetricRenderer
            data={buildMetricItem(row, headers, fieldMapping)}
            format={format}
            conditionalFormats={conditionalFormats}
          />
        </div>
      ))}
    </div>
  );
}
