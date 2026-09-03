// Output editor sheet (task 5.1) -- kind + name + capabilities-at-node-driven
// mapping shell, built from `BindingEditor.tsx` (design.md decision 3). Opens
// against either an existing `Output` (edit) or a target step id with no
// Output yet (create). Owns its own save/create/delete + placements +
// live-preview plumbing; `PipelineDetailPage` only owns open/close state.
//
// CONTRIBUTING.md file-size note: this file sits a bit over the ~400-line
// soft budget (~580 lines, rounded deliberately per skeptic-final-scope-
// round2's CR2 note so a small future edit to this very comment does not
// immediately go stale again -- see tasks.md 10.4 for the exact `wc -l`
// count as of the commit that last touched this file). Config-assembly (`buildOutputConfig.ts`) and
// per-kind field rendering (`OutputKindFields.tsx`) are already extracted;
// what remains is per-kind local state (six kinds x a handful of `useState`
// calls each -- mirrors `BindingEditor.tsx`'s own pre-split size, which held
// every kind's state in one component too) plus the JSX kind switch. A
// further split (e.g. one state-hook per kind) was judged to trade real
// file-size compliance for indirection that would make the six kinds' shared
// save/create/delete/preview lifecycle harder to follow in one place --
// noted here rather than silently over budget.

import { useEffect, useMemo, useState } from "react";

import { Modal, Select, TextField, type SelectOption } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import type { ChartType } from "../../../../utils/chartAppearance";
import type {
  BarChartOptions,
  ChartTypeOptionsMap,
  LineChartOptions,
  PieChartOptions,
  ScatterChartOptions,
} from "../../../panels/types/panel";
import { useBoundOrLiteralState } from "../../../panels/ui/editors/useBoundOrLiteralState";
import { defaultBoundOrLiteralMode } from "../../../panels/ui/editors/BoundOrLiteralField";
import {
  createOutput,
  deleteOutput,
  fetchNodeCapabilities,
  previewOutput,
  selectNodeCapabilities,
  updateOutput,
} from "../../state/outputsSlice";
import type { Output, OutputKind, OutputPanelPlacement } from "../../types/output";
import type { AggregateConfig } from "../../types/pipelineStep";
import { getOutputRows, listOutputPanels } from "../../services/outputService";
import { useOutputPreview, useUnsavedStepPreview } from "../../hooks/usePipelinePreviewCache";
import type { Step } from "../../types/step";
import {
  aggColumnOptions,
  columnOptions,
  readChartConfig,
  readCollectionConfig,
  readMarkdownConfig,
  readMetricConfig,
  readTableConfig,
  readTimelineConfig,
} from "./outputConfigTypes";
import {
  buildAggregateTailConfigs,
  buildOutputConfig,
  canAddAsTailWithAggregate,
} from "./buildOutputConfig";
import {
  ChartKindFields,
  MarkdownKindFields,
  METRIC_FORMAT_OPTIONS,
  MetricKindFields,
  SimpleMappingFields,
  TableKindFields,
} from "./OutputKindFields";
import { useOutputTableColumns } from "./useOutputTableColumns";
import { OutputPreviewPane } from "./OutputPreviewPane";
import "./OutputEditorSheet.css";

const KIND_OPTIONS: SelectOption[] = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
  { value: "metric", label: "Metric" },
  { value: "collection", label: "Collection" },
  { value: "timeline", label: "Timeline" },
  { value: "markdown", label: "Markdown" },
];

interface OutputEditorSheetProps {
  open: boolean;
  onClose: () => void;
  pipelineId: string;
  /** The Output being edited, or `null` when creating a new one. */
  output: Output | null;
  /** Target step for a NEW Output (`undefined` = pipeline root). Ignored when
   *  `output` is set (an existing Output's `nodeStepId` is immutable here). */
  createTargetStepId?: string;
  /** Every trunk/tail step, for the create-time step picker (task 4.4). */
  steps: Step[];
  /** task 5.6 -- "Add as tail with aggregate": creates a new `aggregate`
   *  pipeline step as a tail off `nodeStepId`, then this Output on the new
   *  step. Only meaningful while creating (an existing Output's node is
   *  immutable in this sheet). Omitted in contexts that don't wire it (e.g.
   *  tests exercising other slots) -- the affordance simply doesn't render. */
  onAddAsTailWithAggregate?: (
    parentStepId: string,
    aggregateConfig: AggregateConfig,
    outputPayload: { kind: string; name: string; config: Record<string, unknown> },
  ) => Promise<Output>;
  /** HEL-946 Bug C(2) — runs the pipeline from the never-materialized
   *  warning banner's affordance. Omitted in contexts that don't wire it
   *  (e.g. tests), same convention as `onAddAsTailWithAggregate`. */
  onRunPipeline?: () => void;
}

const EMPTY_CHART_OPTIONS: ChartTypeOptionsMap = {};

export function OutputEditorSheet({
  open,
  onClose,
  pipelineId,
  output,
  createTargetStepId,
  steps,
  onAddAsTailWithAggregate,
  onRunPipeline,
}: OutputEditorSheetProps) {
  const dispatch = useAppDispatch();
  const isCreate = output === null;

  const [nodeStepId, setNodeStepId] = useState<string | undefined>(
    isCreate ? createTargetStepId : output?.nodeStepId,
  );
  const [kind, setKind] = useState<OutputKind>((output?.kind as OutputKind) ?? "chart");
  const [name, setName] = useState(output?.name ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [placements, setPlacements] = useState<OutputPanelPlacement[] | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // HEL-946 Bug C(2) -- `null` while unknown/loading, `false` when the
  // saved Output has never been materialized by a successful run (so a
  // dashboard panel bound to it currently shows "No data available"),
  // `true` once materialized (a stored-empty result is a legitimate empty
  // result, not a warning). Only meaningful for an EXISTING Output -- a
  // brand-new one has no saved rows to check yet.
  const [neverMaterialized, setNeverMaterialized] = useState<boolean | null>(null);

  // Re-seed local state whenever a different Output/create-target opens
  // (the sheet instance is reused across opens rather than remounted).
  useEffect(() => {
    if (!open) return;
    setNodeStepId(isCreate ? createTargetStepId : output?.nodeStepId);
    setKind((output?.kind as OutputKind) ?? "chart");
    setName(output?.name ?? "");
    setSaveError(null);
    setConfirmingDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, output?.id]);

  const capabilities = useAppSelector((state) =>
    selectNodeCapabilities(state, pipelineId, nodeStepId),
  );
  useEffect(() => {
    if (!open) return;
    void dispatch(fetchNodeCapabilities({ pipelineId, stepId: nodeStepId }));
  }, [open, dispatch, pipelineId, nodeStepId]);

  // task 5.7 -- placements fetched fresh on every open (safety-critical for
  // the delete-warning count, design.md decision 9).
  useEffect(() => {
    if (!open || isCreate || !output) {
      setPlacements(null);
      return;
    }
    let cancelled = false;
    void listOutputPanels(output.id).then((result) => {
      if (!cancelled) setPlacements(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, isCreate, output]);

  // HEL-946 Bug C(2) -- fetch the SAVED row-materialization status (distinct
  // from the live preview below, which re-runs the node fresh every time and
  // so never reflects whether a real pipeline run has ever persisted a
  // snapshot for this node). One row is enough to know `materialized`.
  useEffect(() => {
    if (!open || isCreate || !output) {
      setNeverMaterialized(null);
      return;
    }
    let cancelled = false;
    void getOutputRows(output.id, 0, 1).then((result) => {
      if (!cancelled) setNeverMaterialized(!result.materialized);
    });
    return () => {
      cancelled = true;
    };
  }, [open, isCreate, output]);

  const config = useMemo(() => output?.config ?? {}, [output]);
  const chartConfig = useMemo(() => readChartConfig(config), [config]);
  const tableConfig = useMemo(() => readTableConfig(config), [config]);
  const metricConfig = useMemo(() => readMetricConfig(config), [config]);
  const markdownConfig = useMemo(() => readMarkdownConfig(config), [config]);
  const collectionConfig = useMemo(() => readCollectionConfig(config), [config]);
  const timelineConfig = useMemo(() => readTimelineConfig(config), [config]);

  // Chart
  const [chartType, setChartType] = useState<ChartType>(chartConfig.chartType);
  const [chartFieldMapping] = useState(chartConfig.fieldMapping);
  const [groupBy, setGroupBy] = useState(chartConfig.aggregation?.groupBy ?? "");
  const [chartAggFn, setChartAggFn] = useState<string>(chartConfig.aggregation?.agg ?? "");
  const [yField, setYField] = useState(chartConfig.aggregation?.yField ?? "");
  const [chartOptionsState, setChartOptionsState] = useState<ChartTypeOptionsMap>(
    chartConfig.chartOptions ?? EMPTY_CHART_OPTIONS,
  );
  const annotationState = useBoundOrLiteralState(
    defaultBoundOrLiteralMode(
      chartConfig.annotation !== undefined && chartConfig.annotation !== null,
    ),
    chartConfig.fieldMapping.annotation ?? "",
    chartConfig.annotation ?? "",
  );

  // Table
  const [tableFieldMapping] = useState(tableConfig.fieldMapping);
  const tableCols = useOutputTableColumns(
    capabilities ? capabilities.columns.map((c) => c.name) : [],
    tableConfig.columnOrder,
  );

  // Metric
  const [metricField, setMetricField] = useState(metricConfig.fieldMapping.value ?? "");
  const [metricAggFn, setMetricAggFn] = useState<string>(metricConfig.aggregation?.agg ?? "");
  const metricLabelState = useBoundOrLiteralState(
    defaultBoundOrLiteralMode(metricConfig.label !== undefined),
    metricConfig.fieldMapping.label ?? "",
    metricConfig.label ?? "",
  );
  const metricUnitState = useBoundOrLiteralState(
    defaultBoundOrLiteralMode(metricConfig.unit !== undefined),
    metricConfig.fieldMapping.unit ?? "",
    metricConfig.unit ?? "",
  );
  const [metricFormat, setMetricFormat] = useState<string>(metricConfig.format ?? "number");

  // Markdown
  const markdownContentState = useBoundOrLiteralState(
    defaultBoundOrLiteralMode(markdownConfig.fieldMapping.content === undefined),
    markdownConfig.fieldMapping.content ?? "",
    markdownConfig.content ?? "",
  );

  // Collection / Timeline (lighter-weight slots -- task 5.1)
  const [collectionFieldMapping, setCollectionFieldMapping] = useState(
    collectionConfig.fieldMapping,
  );
  const [timelineFieldMapping, setTimelineFieldMapping] = useState(timelineConfig.fieldMapping);
  const [collectionFormat, setCollectionFormat] = useState<string>(
    collectionConfig.format ?? "number",
  );

  const fieldOptions = columnOptions(capabilities);
  const aggFieldOptions = aggColumnOptions(capabilities);

  // task 5.5 -- live preview, saved vs. unsaved arm (design.md decision 6a).
  const savedPreview = useOutputPreview(pipelineId, output?.id ?? "");
  const unsavedPreview = useUnsavedStepPreview(pipelineId, nodeStepId ?? "__root__");
  const previewEntry = isCreate ? unsavedPreview : savedPreview;

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      void previewEntry.refresh();
    }, 400);
    return () => clearTimeout(handle);
    // Debounced re-fetch on open + whenever the target node changes. The
    // preview endpoints don't apply in-progress config server-side (decision
    // 6a) so field/kind edits re-render client-side against the same rows
    // without re-fetching -- only a node/save-state change needs a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isCreate, output?.id, nodeStepId]);

  function buildConfig(): Record<string, unknown> {
    return buildOutputConfig({
      kind,
      chartType,
      chartFieldMapping,
      groupBy,
      chartAggFn,
      yField,
      chartOptionsState,
      annotationState,
      tableFieldMapping,
      tableColumnOrder: tableCols.columnOrder,
      metricField,
      metricAggFn,
      metricLabelState,
      metricUnitState,
      metricFormat,
      markdownContentState,
      collectionFieldMapping,
      collectionFormat,
      timelineFieldMapping,
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      if (isCreate) {
        const created = await dispatch(
          createOutput({
            pipelineId,
            payload: {
              nodeStepId,
              kind,
              name: name.trim() || "Untitled output",
              config: buildConfig(),
            },
          }),
        ).unwrap();
        // HEL-908 Cycle 13 -- the preview fetched while creating (above,
        // `unsavedPreview`) is cached under the unsaved `step:<stepId>` key,
        // not the new Output's real id. Without this, the rail chip for a
        // freshly-created Output shows no preview until its sheet is
        // reopened (`OutputsRail` never fetches on its own).
        void dispatch(previewOutput({ pipelineId, outputId: created.id }));
      } else if (output) {
        await dispatch(
          updateOutput({
            outputId: output.id,
            payload: { name: name.trim(), config: buildConfig() },
          }),
        ).unwrap();
      }
      onClose();
    } catch {
      setSaveError("Failed to save output.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!output) return;
    setSaving(true);
    try {
      await dispatch(deleteOutput({ outputId: output.id, pipelineId })).unwrap();
      onClose();
    } catch {
      setSaveError("Failed to delete output.");
      setSaving(false);
    }
  }

  const stepOptions: SelectOption[] = [
    { value: "", label: "Pipeline root" },
    ...steps.map((s) => ({ value: s.id, label: s.label })),
  ];

  // task 5.6 -- "Add as tail with aggregate": only meaningful while
  // creating, against a real node (an aggregate step needs a `parentStepId`
  // -- the pipeline root has no step id to attach off), for the two kinds
  // that carry aggregation fields in this sheet.
  const canAddTailWithAggregate =
    isCreate &&
    Boolean(nodeStepId) &&
    Boolean(onAddAsTailWithAggregate) &&
    canAddAsTailWithAggregate({ kind, groupBy, chartAggFn, yField, metricField, metricAggFn });

  async function handleAddTailWithAggregate() {
    if (!onAddAsTailWithAggregate || !nodeStepId) return;
    const built = buildAggregateTailConfigs(
      {
        kind,
        groupBy,
        chartAggFn,
        yField,
        chartType,
        chartOptionsState,
        annotationState,
        metricField,
        metricAggFn,
        metricLabelState,
        metricUnitState,
        metricFormat,
      },
      capabilities,
    );
    if (!built) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onAddAsTailWithAggregate(nodeStepId, built.aggregateConfig, {
        kind,
        name: name.trim() || "Untitled output",
        config: built.outputConfig,
      });
      onClose();
    } catch {
      setSaveError("Failed to add tail with aggregate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isCreate ? "New output" : `Edit ${output?.name ?? "output"}`}
      open={open}
      onClose={onClose}
      size="lg"
      footer={
        <div className="output-editor-sheet__footer">
          {!isCreate && (
            <button
              type="button"
              className="ui-modal-btn ui-modal-btn--danger output-editor-sheet__delete"
              onClick={() => (confirmingDelete ? void handleDelete() : setConfirmingDelete(true))}
              disabled={saving}
            >
              {confirmingDelete
                ? `Confirm delete${placements && placements.length > 0 ? ` (removes from ${placements.length} dashboard${placements.length === 1 ? "" : "s"})` : ""}`
                : "Delete"}
            </button>
          )}
          <button
            type="button"
            className="ui-modal-btn ui-modal-btn--secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          {canAddTailWithAggregate && (
            <button
              type="button"
              className="ui-modal-btn ui-modal-btn--secondary output-editor-sheet__add-tail"
              onClick={() => void handleAddTailWithAggregate()}
              disabled={saving}
            >
              {saving ? "Adding…" : "Add as tail with aggregate"}
            </button>
          )}
          <button
            type="button"
            className="ui-modal-btn ui-modal-btn--primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="output-editor-sheet__group">
        <div className="output-editor-sheet__data-section">
          <label className="output-editor-sheet__data-label" htmlFor="output-name">
            Name
          </label>
          <TextField
            id="output-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled output"
          />
        </div>

        {isCreate && (
          <div className="output-editor-sheet__data-section">
            <label className="output-editor-sheet__data-label" htmlFor="output-step">
              Step
            </label>
            <Select
              ariaLabel="Target step"
              value={nodeStepId ?? ""}
              onChange={(v) => setNodeStepId(v === "" ? undefined : v)}
              options={stepOptions}
            />
          </div>
        )}

        <div className="output-editor-sheet__data-section">
          <label className="output-editor-sheet__data-label" htmlFor="output-kind">
            Kind
          </label>
          <Select
            ariaLabel="Output kind"
            value={kind}
            onChange={(v) => setKind(v as OutputKind)}
            options={KIND_OPTIONS}
          />
        </div>
      </div>

      <div className="output-editor-sheet__group output-editor-sheet__group--card">
        <h3 className="output-editor-sheet__edit-section-heading">Configuration</h3>
        {kind === "chart" && (
          <ChartKindFields
            fieldOptions={aggFieldOptions}
            chartType={chartType}
            onChartTypeChange={setChartType}
            groupByValue={groupBy}
            onGroupByChange={setGroupBy}
            valueFieldValue={yField}
            onValueFieldChange={setYField}
            aggFnValue={chartAggFn}
            onAggFnChange={setChartAggFn}
            line={chartOptionsState.line ?? ({} as LineChartOptions)}
            onLineChange={(patch) =>
              setChartOptionsState((prev) => ({ ...prev, line: { ...prev.line, ...patch } }))
            }
            bar={chartOptionsState.bar ?? ({} as BarChartOptions)}
            onBarChange={(patch) =>
              setChartOptionsState((prev) => ({ ...prev, bar: { ...prev.bar, ...patch } }))
            }
            pie={chartOptionsState.pie ?? ({} as PieChartOptions)}
            onPieChange={(patch) =>
              setChartOptionsState((prev) => ({ ...prev, pie: { ...prev.pie, ...patch } }))
            }
            scatter={chartOptionsState.scatter ?? ({} as ScatterChartOptions)}
            onScatterChange={(patch) =>
              setChartOptionsState((prev) => ({ ...prev, scatter: { ...prev.scatter, ...patch } }))
            }
            annotationState={annotationState}
          />
        )}
        {kind === "table" && (
          <TableKindFields
            columns={tableCols.columns}
            onToggleVisible={tableCols.toggleVisible}
            onMoveUp={tableCols.moveUp}
            onMoveDown={tableCols.moveDown}
            onMoveToTop={tableCols.moveToTop}
            onMoveToBottom={tableCols.moveToBottom}
          />
        )}
        {kind === "metric" && (
          <MetricKindFields
            fieldOptions={aggFieldOptions}
            fieldValue={metricField}
            onFieldChange={setMetricField}
            reduceValue={metricAggFn}
            onReduceChange={setMetricAggFn}
            labelState={metricLabelState}
            unitState={metricUnitState}
            formatValue={metricFormat}
            onFormatChange={setMetricFormat}
          />
        )}
        {kind === "markdown" && (
          <MarkdownKindFields fieldOptions={fieldOptions} contentState={markdownContentState} />
        )}
        {kind === "collection" && (
          <>
            <SimpleMappingFields
              title="Item fields"
              slots={[
                { key: "value", label: "Value" },
                { key: "label", label: "Label" },
                { key: "unit", label: "Unit" },
              ]}
              fieldMapping={collectionFieldMapping}
              onFieldChange={(k, v) => setCollectionFieldMapping((prev) => ({ ...prev, [k]: v }))}
              fieldOptions={fieldOptions}
            />
            <div className="output-editor-sheet__data-section">
              <label className="output-editor-sheet__data-label" htmlFor="output-collection-format">
                Format
              </label>
              <Select
                ariaLabel="Format"
                value={collectionFormat}
                onChange={setCollectionFormat}
                options={METRIC_FORMAT_OPTIONS}
              />
            </div>
          </>
        )}
        {kind === "timeline" && (
          <SimpleMappingFields
            title="Timeline fields"
            slots={[
              { key: "time", label: "Time" },
              { key: "event", label: "Event" },
            ]}
            fieldMapping={timelineFieldMapping}
            onFieldChange={(k, v) => setTimelineFieldMapping((prev) => ({ ...prev, [k]: v }))}
            fieldOptions={fieldOptions}
          />
        )}
      </div>

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
              This output hasn&rsquo;t been included in a saved run yet, so any dashboard panel
              bound to it currently shows &ldquo;No data available.&rdquo; Run the pipeline to
              populate it.
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
          rows={previewEntry.result}
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
          markdownContent={
            markdownContentState.mode === "literal" ? markdownContentState.literalValue : undefined
          }
        />
      </div>

      {!isCreate && placements && (
        <div className="output-editor-sheet__group">
          <div className="output-editor-sheet__data-section">
            <span className="output-editor-sheet__data-label">
              Placements ({placements.length})
            </span>
            {placements.length === 0 ? (
              <p className="output-editor-sheet__field-hint">Not placed on any dashboard yet.</p>
            ) : (
              <ul className="output-editor-sheet__placements">
                {placements.map((p) => (
                  <li key={p.panelId}>
                    <a href={`/dashboards/${p.dashboardId}`}>Dashboard {p.dashboardId}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <InlineError error={saveError} />
    </Modal>
  );
}
