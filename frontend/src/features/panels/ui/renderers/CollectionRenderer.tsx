import "./CollectionRenderer.css";
import type { CollectionPanel, MappedPanelData } from "../../types/panel";
import { MetricRenderer } from "./MetricRenderer";

interface CollectionRendererProps {
  panel: CollectionPanel;
  /** Fetched snapshot rows (string cells, aligned to `headers`) — one row per
   *  rendered item, the table fetch path. */
  rawRows?: string[][] | null;
  /** Column names aligned to each `rawRows` row. */
  headers?: string[] | null;
}

/** Map one fetched row to a metric item's `MappedPanelData` (HEL-247 D4).
 *  Each `fieldMapping` slot (value/label/unit) resolves to that row's cell for
 *  the mapped column; literal `itemOptions.metric` overrides win over the bound
 *  slot on every item (HEL-243 literal-wins semantics). */
function buildMetricItem(
  row: string[],
  headers: string[],
  fieldMapping: Record<string, string>,
  metricOptions: { label?: string; unit?: string } | undefined,
): MappedPanelData {
  const item: MappedPanelData = {};
  for (const [slot, column] of Object.entries(fieldMapping)) {
    const idx = headers.indexOf(column);
    item[slot] = idx >= 0 ? (row[idx] ?? "") : "";
  }
  if (metricOptions?.label) item.label = metricOptions.label;
  if (metricOptions?.unit) item.unit = metricOptions.unit;
  return item;
}

/** Collection body — expands one bound row into one homogeneous item (HEL-247).
 *  v1 ships the `metric` base type only: each item reuses `MetricRenderer` so it
 *  gets the exact Metric visual language. Grid layout wraps responsively (no
 *  horizontal overflow at 390px); list layout is a single divided column. */
export function CollectionRenderer({ panel, rawRows, headers }: CollectionRendererProps) {
  const { dataTypeId, fieldMapping, layout } = panel.config;
  const metricOptions = panel.config.itemOptions?.metric;

  // Unbound → invite configuration (consistent with the other data-bound kinds'
  // state styling), never an error.
  if (!dataTypeId) {
    return (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">
          Bind a data type to populate this collection
        </span>
      </div>
    );
  }

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
          <MetricRenderer data={buildMetricItem(row, headers, fieldMapping, metricOptions)} />
        </div>
      ))}
    </div>
  );
}
