// HEL-1350 -- the chart Output editor's Compare picker: the select, the fixed help text, and an
// Output-level note when THIS Output's own config rules the dashboard "vs" overlay out.

import { Select } from "../../../../shared/ui/index";
import type { ChartCompareBlocker } from "../../../panels/history/chartOverlay";
import { CHART_COMPARE_OPTIONS, compareOptions } from "./compareOptions";

const CHART_COMPARE_HELP_ID = "output-chart-compare-help";
const CHART_COMPARE_NOTE_ID = "output-chart-compare-note";
const CHART_COMPARE_HELP =
  "Adds a “vs” line or bars to dashboard charts. It doesn't show for pie or scatter panels, multi-series charts, horizontal or 100% stacked bars, aggregated Outputs, Outputs with more than 200 rows, or while a filter is applied.";
const CHART_COMPARE_NOTES: Record<ChartCompareBlocker, string> = {
  aggregated: "This Output aggregates its rows, so dashboards won't show the comparison.",
  series: "This Output splits into several series, so dashboards won't show the comparison.",
  unmapped: "This Output doesn't name x and y fields, so dashboards won't show the comparison.",
  horizontal: "Horizontal bars don't show the comparison on bar panels.",
  normalized: "100% stacked bars don't show the comparison on bar panels.",
};

interface ChartCompareFieldProps {
  /** `"none"` or a `config.compare` token. */
  value: string;
  onChange: (v: string) => void;
  blocker: ChartCompareBlocker | null;
}

export function ChartCompareField({ value, onChange, blocker }: ChartCompareFieldProps) {
  const note = value !== "none" && blocker ? CHART_COMPARE_NOTES[blocker] : null;
  const describedBy = note
    ? `${CHART_COMPARE_HELP_ID} ${CHART_COMPARE_NOTE_ID}`
    : CHART_COMPARE_HELP_ID;
  return (
    <div className="output-editor-sheet__data-section">
      <span className="output-editor-sheet__data-label">Compare</span>
      <Select
        ariaLabel="Compare"
        ariaDescribedBy={describedBy}
        value={value}
        onChange={onChange}
        options={compareOptions(value, CHART_COMPARE_OPTIONS)}
      />
      <p id={CHART_COMPARE_HELP_ID} className="output-editor-sheet__field-hint">
        {CHART_COMPARE_HELP}
      </p>
      {note && (
        <p id={CHART_COMPARE_NOTE_ID} className="output-editor-sheet__type-hint">
          {note}
        </p>
      )}
    </div>
  );
}
