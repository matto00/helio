import { lazy, Suspense, useMemo } from "react";

import type { ChartTypeOptionsMap, PanelAppearance } from "../../types/panel";
import type { GroupedAggregate } from "../../../../utils/aggregate";
import type { ChartClickSelection } from "../../../../utils/chartClickSelection";
import type { ChartAggregationSpec, ChartOverlay } from "../../history/chartOverlay";
import type { ReferenceMarks } from "../../../../utils/referenceMarks";
import { PanelSuspenseFallback } from "../../../../shared/ui/SuspenseFallback";
import type { ChartFieldTypes } from "../../../../utils/chartTimeAxis";
import { binHistogram } from "../../../../utils/histogramBins";

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
  /** HEL-1351: forwarded to `ChartPanel` — the aggregation `chartAggregate` was grouped by. */
  aggregationSpec?: ChartAggregationSpec | null;
  /** HEL-248: forwarded to `ChartPanel` — persisted per-type display options. */
  chartOptions?: ChartTypeOptionsMap | null;
  /** HEL-1277: forwarded to `ChartPanel` — a labelled "vs" comparison series. */
  overlay?: ChartOverlay | null;
  /** HEL-1306: forwarded to `ChartPanel` -- static reference lines/bands. */
  referenceMarks?: ReferenceMarks | null;
  /** HEL-318: optional static subtitle/footnote rendered beneath the chart
   *  canvas. Absent/blank renders nothing. */
  annotation?: string | null;
  /** HEL-1358: note that the chart is based on only the loaded rows; absent renders nothing. It shares
   *  the annotation footnote's two-line clamp, so at the grid's narrowest width the total is not
   *  ellipsised away. */
  truncationNote?: string | null;
  /** HEL-1398: the short form of `truncationNote` ("200 of 1,234 rows."). On a narrow `panel-card`
   *  the CSS shows it and visually hides (never removes) the full sentence, so the note fits one
   *  line and leaves the chart canvas more room; absent renders the full sentence alone. */
  truncationNoteShort?: string | null;
  /** HEL-1305: forwarded to `ChartPanel` — field name -> declared schema type (time x axis). */
  fieldTypes?: ChartFieldTypes | null;
  /** HEL-301: forwarded to `ChartPanel` — see its `compact` prop. */
  compact?: boolean;
  /** HEL-572: forwarded to `ChartPanel` — see its `onDataPointSelect` prop. */
  onDataPointSelect?: (selection: ChartClickSelection) => void;
}

/** HEL-1311 design D5 -- "3 non-numeric values skipped." (histogram only; null when nothing was skipped). */
export function histogramSkippedNote(skipped: number): string | null {
  if (skipped <= 0) return null;
  return `${skipped} non-numeric ${skipped === 1 ? "value" : "values"} skipped.`;
}

export function ChartRenderer({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
  aggregationSpec,
  chartOptions,
  overlay,
  referenceMarks,
  annotation,
  truncationNote,
  truncationNoteShort,
  fieldTypes,
  compact,
  onDataPointSelect,
}: ChartRendererProps) {
  const trimmedAnnotation = annotation?.trim();
  // `buildDataOption` cannot render DOM, so the histogram's skipped-cell count is derived here (the
  // same `binHistogram` parse) and shown in the footnote slot beside the truncation note.
  const isHistogram = appearance?.chart?.chartType === "histogram";
  const skippedNote = useMemo(() => {
    const xCol = fieldMapping?.xAxis && headers ? headers.indexOf(fieldMapping.xAxis) : -1;
    if (!isHistogram || !rawRows || xCol === -1) return null;
    return histogramSkippedNote(
      binHistogram(
        rawRows.map((r) => r[xCol] ?? ""),
        chartOptions?.histogram?.binCount,
      ).skipped,
    );
  }, [isHistogram, rawRows, headers, fieldMapping, chartOptions]);
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
            aggregationSpec={aggregationSpec}
            chartOptions={chartOptions}
            overlay={overlay}
            referenceMarks={referenceMarks}
            fieldTypes={fieldTypes}
            compact={compact}
            onDataPointSelect={onDataPointSelect}
          />
        </Suspense>
      </div>
      {trimmedAnnotation ? (
        <p className="chart-panel__annotation" title={trimmedAnnotation}>
          {trimmedAnnotation}
        </p>
      ) : null}
      {truncationNote ? (
        <p className="chart-panel__truncation-note" title={truncationNote}>
          {truncationNoteShort ? (
            <>
              <span className="chart-panel__truncation-note-long">{truncationNote}</span>
              <span className="chart-panel__truncation-note-short" aria-hidden="true">
                {truncationNoteShort}
              </span>
            </>
          ) : (
            truncationNote
          )}
        </p>
      ) : null}
      {skippedNote ? (
        <p className="chart-panel__truncation-note chart-panel__skipped-note" title={skippedNote}>
          {skippedNote}
        </p>
      ) : null}
    </div>
  );
}
