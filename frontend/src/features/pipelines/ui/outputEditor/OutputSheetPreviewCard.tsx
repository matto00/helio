// The editor sheet's Preview card: the never-materialized banner plus the live preview pane
// (extracted verbatim from `OutputEditorSheet.tsx`).

import type { OutputKind, RunResult } from "../../types/output";
import { OutputPreviewPane } from "./OutputPreviewPane";
import type { OutputKindState } from "./useOutputKindState";

interface OutputSheetPreviewCardProps {
  kind: OutputKind;
  kindState: OutputKindState;
  rows: RunResult | undefined;
  neverMaterialized: boolean | null;
  onRunPipeline?: () => void;
}

export function OutputSheetPreviewCard({
  kind,
  kindState,
  rows,
  neverMaterialized,
  onRunPipeline,
}: OutputSheetPreviewCardProps) {
  const {
    chartType,
    chartFieldMapping,
    groupBy,
    chartAggFn,
    yField,
    chartOptionsState,
    annotationState,
    tableCols,
    metricField,
    metricAggFn,
    metricLabelState,
    metricUnitState,
    metricFormat,
    markdownContent,
  } = kindState;
  return (
    <div className="output-editor-sheet__group output-editor-sheet__group--card">
      <h3 className="output-editor-sheet__edit-section-heading">Preview</h3>
      {neverMaterialized && (
        // HEL-946 Bug C(2) -- the preview below re-runs the node live and
        // always shows current data, which is why it can look fine even
        // though a dashboard panel bound to this SAVED Output currently
        // shows "No data available": this node has never had a successful
        // pipeline run since the Output was added, so nothing has been
        // written to its saved snapshot yet. Distinct from a genuinely
        // empty result (that case renders no banner at all).
        <div className="output-editor-sheet__data-section" role="status">
          <p className="output-editor-sheet__field-hint">
            This output hasn&rsquo;t been included in a saved run yet, so any dashboard panel bound
            to it currently shows &ldquo;No data available.&rdquo; Run the pipeline to populate it.
          </p>
          {onRunPipeline && (
            <button
              type="button"
              className="ui-modal-btn ui-modal-btn--secondary"
              onClick={onRunPipeline}
            >
              Run pipeline
            </button>
          )}
        </div>
      )}
      <OutputPreviewPane
        kind={kind}
        rows={rows}
        loading={false}
        chartType={chartType}
        chartFieldMapping={chartFieldMapping}
        chartGroupBy={groupBy}
        chartAggFn={chartAggFn}
        chartYField={yField}
        chartOptions={chartOptionsState}
        chartAnnotation={
          annotationState.mode === "literal" ? annotationState.literalValue : undefined
        }
        tableColumns={tableCols.columns.filter((c) => c.visible).map((c) => c.key)}
        metricField={metricField}
        metricAggFn={metricAggFn}
        metricLabel={
          metricLabelState.mode === "literal" ? metricLabelState.literalValue : undefined
        }
        metricUnit={metricUnitState.mode === "literal" ? metricUnitState.literalValue : undefined}
        metricFormat={metricFormat}
        markdownContent={markdownContent}
      />
    </div>
  );
}
