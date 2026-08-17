import { lazy, Suspense } from "react";

import type { ChartTypeOptionsMap, PanelAppearance } from "../../types/panel";
import type { GroupedAggregate } from "../../../../utils/aggregate";
import { PanelSuspenseFallback } from "../../../../shared/ui/SuspenseFallback";

// HEL-512 — `echarts`/`echarts-for-react` (see `ChartPanel.tsx`'s own docblock) is loaded via a
// dynamic `import()` so its module graph lands in a separate, non-entry chunk instead of the
// initial JS payload. `ChartPanel` is a named export (not default), so `React.lazy` — which
// requires a promise resolving to a `{ default }` shape — needs this adapter. See design.md
// Decision 1: only this internal import becomes lazy; `ChartRenderer`'s own export/signature (and
// `PanelContent.tsx`'s static import of it) are unchanged.
const ChartPanel = lazy(() => import("../ChartPanel").then((m) => ({ default: m.ChartPanel })));

interface ChartRendererProps {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  chartAggregate?: GroupedAggregate | null;
  /** HEL-248: forwarded to `ChartPanel` — persisted per-type display options. */
  chartOptions?: ChartTypeOptionsMap | null;
  /** HEL-318: optional static subtitle/footnote rendered beneath the chart
   *  canvas. Absent/blank renders nothing. */
  annotation?: string | null;
  /** HEL-301: forwarded to `ChartPanel` — see its `compact` prop. */
  compact?: boolean;
}

export function ChartRenderer({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
  chartOptions,
  annotation,
  compact,
}: ChartRendererProps) {
  const trimmedAnnotation = annotation?.trim();
  return (
    <div className="panel-content panel-content--chart">
      <div className="chart-panel__canvas">
        <Suspense fallback={<PanelSuspenseFallback />}>
          <ChartPanel
            appearance={appearance}
            rawRows={rawRows}
            headers={headers}
            fieldMapping={fieldMapping}
            chartAggregate={chartAggregate}
            chartOptions={chartOptions}
            compact={compact}
          />
        </Suspense>
      </div>
      {trimmedAnnotation ? (
        <p className="chart-panel__annotation" title={trimmedAnnotation}>
          {trimmedAnnotation}
        </p>
      ) : null}
    </div>
  );
}
