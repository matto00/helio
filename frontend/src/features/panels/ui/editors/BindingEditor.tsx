import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";

import { Select } from "../../../../shared/ui/index";
import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../../dataTypes/state/dataTypesSlice";
import { PANEL_SLOTS } from "../../state/panelSlots";
import { updatePanelBinding } from "../../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import type {
  AggFn,
  ChartAggregation,
  ChartPanel,
  MetricAggregation,
  MetricPanel,
  TablePanel,
} from "../../types/panel";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { ChartType } from "../../../../utils/chartAppearance";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";
import { defaultBoundOrLiteralMode, type BoundOrLiteralMode } from "./BoundOrLiteralField";
import { MetricBindingFields } from "./MetricBindingFields";
import { ChartAggregationFields } from "./ChartAggregationFields";
import { ChartDisplayFields } from "./ChartDisplayFields";
import { TableDisplayFields } from "./TableDisplayFields";
import { FieldMappingSlots } from "./FieldMappingSlots";
import { DataTypePicker } from "./DataTypePicker";
import { aggFieldOptions, fieldOptions } from "./fieldOptions";
import { useBoundOrLiteralState } from "./useBoundOrLiteralState";
import { useChartDisplayState } from "./useChartDisplayState";
import { useTableDisplayState } from "./useTableDisplayState";

function isAggFn(value: string): value is AggFn {
  return (
    value === "count" || value === "sum" || value === "avg" || value === "min" || value === "max"
  );
}

interface BindingEditorProps {
  panel: MetricPanel | ChartPanel | TablePanel;
  /** Optional poll interval persisted only on the frontend until CS3 cleanup. */
  initialRefreshInterval: number | null;
  /** HEL-248: the *live* chart type selected in the Appearance section (the
   *  modal owns `chartAppearance` state). Drives which chart Display controls
   *  render, swapping before save. Only meaningful for chart panels. */
  chartType?: ChartType;
  onDirtyChange: DirtyChangeCallback;
}

/** Per-panel typed binding (`dataTypeId` + `fieldMapping`) editor used by the
 *  three bound-capable subtypes (metric, chart, table). The previous flat-
 *  field PATCH path still flows through `updatePanelBinding`; this editor
 *  just narrows the inputs from the typed config and pushes them back via
 *  the same thunk so the wire shape ends up as a typed PATCH on `config`. */
export const BindingEditor = forwardRef<PanelEditorHandle, BindingEditorProps>(
  function BindingEditor(
    { panel, initialRefreshInterval, chartType = "line", onDirtyChange },
    ref,
  ) {
    const dispatch = useAppDispatch();
    const dataTypes = useAppSelector((state) => state.dataTypes.items);
    const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
    const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

    const initialTypeId =
      panel.config.dataTypeId && panel.config.dataTypeId.length > 0
        ? panel.config.dataTypeId
        : null;
    const initialFieldMapping = panel.config.fieldMapping;

    // HEL-292 — the aggregation spec's shape depends on panel.type; `aggField`
    // doubles as metric's `value` field and chart's `groupBy` field to keep a
    // single set of hooks (hooks must be called unconditionally regardless of
    // panel.type). `aggYField` is chart-only.
    const initialMetricAgg: MetricAggregation | null =
      panel.type === "metric" ? (panel.config.aggregation ?? null) : null;
    const initialChartAgg: ChartAggregation | null =
      panel.type === "chart" ? (panel.config.aggregation ?? null) : null;
    // HEL-243 — metric's unified Value control reuses `aggField`/`aggFn` for
    // BOTH the plain-mapping case (`aggFn === ""`, writes `fieldMapping.value`)
    // and the reduced case (writes `aggregation`), so its initial field must
    // fall back to `fieldMapping.value` when no aggregation spec is present
    // (matches `usePanelData.ts`'s existing render-precedence: aggregation
    // wins when both happen to be set on an old-UI-authored panel).
    const initialAggField =
      initialMetricAgg?.value ??
      (panel.type === "metric" ? initialFieldMapping.value : undefined) ??
      initialChartAgg?.groupBy ??
      "";
    const initialAggFn = initialMetricAgg?.agg ?? initialChartAgg?.agg ?? "";
    const initialAggYField = initialChartAgg?.yField ?? "";

    // HEL-243 — Label/Unit bind-or-literal state, metric only. Mode defaults
    // to "literal" when `config.label`/`config.unit` is set (matches HEL-293's
    // documented literal-wins precedence), else "field" from any existing
    // `fieldMapping.label`/`fieldMapping.unit` binding.
    const initialLabelMode: BoundOrLiteralMode =
      panel.type === "metric"
        ? defaultBoundOrLiteralMode(panel.config.label !== undefined)
        : "field";
    const initialUnitMode: BoundOrLiteralMode =
      panel.type === "metric"
        ? defaultBoundOrLiteralMode(panel.config.unit !== undefined)
        : "field";
    const initialLabelField = initialFieldMapping.label ?? "";
    const initialUnitField = initialFieldMapping.unit ?? "";
    const initialLabelLiteral = panel.type === "metric" ? (panel.config.label ?? "") : "";
    const initialUnitLiteral = panel.type === "metric" ? (panel.config.unit ?? "") : "";

    const [selectedTypeId, setSelectedTypeId] = useState<string | null>(initialTypeId);
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>(initialFieldMapping);
    const [refreshInterval, setRefreshInterval] = useState<number | null>(initialRefreshInterval);
    const [typeSearch, setTypeSearch] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);
    const [aggField, setAggField] = useState<string>(initialAggField);
    const [aggFn, setAggFn] = useState<string>(initialAggFn);
    const [aggYField, setAggYField] = useState<string>(initialAggYField);
    const labelState = useBoundOrLiteralState(
      initialLabelMode,
      initialLabelField,
      initialLabelLiteral,
    );
    const unitState = useBoundOrLiteralState(initialUnitMode, initialUnitField, initialUnitLiteral);

    // Bound DataType currently selected + its field keys (natural order) —
    // needed by the Table display-config hook, so derived before it. HEL-255.
    const selectedType = dataTypes.find((dt) => dt.id === selectedTypeId) ?? null;
    const fieldKeys = selectedType ? fieldOptions(selectedType).map((option) => option.value) : [];
    const tableDisplay = useTableDisplayState(panel, fieldKeys, selectedTypeId);
    // HEL-248 — chart per-type display options (inert for non-chart kinds). The
    // working map holds every type's options; the live `chartType` only decides
    // which controls render, so a type switch never drops another type's entry.
    const chartDisplay = useChartDisplayState(panel);

    const currentAggregation: MetricAggregation | ChartAggregation | null = useMemo(() => {
      if (panel.type === "metric") {
        return aggField && isAggFn(aggFn) ? { value: aggField, agg: aggFn } : null;
      }
      if (panel.type === "chart") {
        return aggField && isAggFn(aggFn) && aggYField
          ? { groupBy: aggField, agg: aggFn, yField: aggYField }
          : null;
      }
      return null;
    }, [panel.type, aggField, aggFn, aggYField]);
    // HEL-292 (cycle-3 fix) — compare the underlying primitive field state
    // directly rather than `JSON.stringify`-ing `currentAggregation` against
    // an `initialAggregation` object read straight off `panel.config`.
    // Postgres JSONB does not preserve object key order, so the initial
    // object round-trips with a different key order than `currentAggregation`
    // (always freshly constructed via a fixed-order literal above), which
    // made the two `JSON.stringify` outputs differ even when semantically
    // identical. Comparing `aggField`/`aggFn`/`aggYField` against their
    // `initial*` counterparts (already-tracked primitive state, mirroring
    // how `selectedTypeId`/`refreshInterval` are compared below) sidesteps
    // key-order entirely.
    const aggregationDirty =
      aggField !== initialAggField ||
      aggFn !== initialAggFn ||
      (panel.type === "chart" && aggYField !== initialAggYField);

    const dataDirty =
      selectedTypeId !== initialTypeId ||
      refreshInterval !== initialRefreshInterval ||
      JSON.stringify(fieldMapping) !== JSON.stringify(initialFieldMapping) ||
      aggregationDirty ||
      (panel.type === "metric" && (labelState.dirty || unitState.dirty)) ||
      (panel.type === "table" && tableDisplay.dirty) ||
      (panel.type === "chart" && chartDisplay.dirty);

    useEffect(() => {
      if (dataTypesStatus === "idle") {
        void dispatch(fetchDataTypes());
      }
    }, [dataTypesStatus, dispatch]);

    useEffect(() => {
      onDirtyChange(dataDirty);
    }, [dataDirty, onDirtyChange]);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          setSelectedTypeId(initialTypeId);
          setFieldMapping(initialFieldMapping);
          setRefreshInterval(initialRefreshInterval);
          setAggField(initialAggField);
          setAggFn(initialAggFn);
          setAggYField(initialAggYField);
          labelState.reset();
          unitState.reset();
          tableDisplay.reset();
          chartDisplay.reset();
          setSaveError(null);
        },
        save: async () => {
          if (!dataDirty) return { ok: true };
          try {
            // HEL-243 — metric no longer writes `fieldMapping` from the
            // generic per-slot loop; it's derived wholesale from the Value/
            // Label/Unit controls' current state every save (mirrors the
            // pre-existing chart/table behavior of resending the whole
            // `fieldMapping` object, since the backend patch replaces it
            // entirely rather than merging — see `MetricPanel.applyPatch`).
            const outgoingFieldMapping: Record<string, string> =
              panel.type === "metric"
                ? {
                    ...(aggFn === "" && aggField ? { value: aggField } : {}),
                    ...(labelState.fieldMappingValue
                      ? { label: labelState.fieldMappingValue }
                      : {}),
                    ...(unitState.fieldMappingValue ? { unit: unitState.fieldMappingValue } : {}),
                  }
                : fieldMapping;
            await dispatch(
              updatePanelBinding({
                panelId: panel.id,
                typeId: selectedTypeId,
                fieldMapping:
                  Object.keys(outgoingFieldMapping).length > 0 ? outgoingFieldMapping : null,
                refreshInterval,
                // `undefined` when the aggregation section wasn't touched —
                // omits the key entirely so an untouched absent spec stays
                // absent (see `buildBindingPatch`).
                aggregation: aggregationDirty ? currentAggregation : undefined,
                label: panel.type === "metric" ? labelState.patchValue : undefined,
                unit: panel.type === "metric" ? unitState.patchValue : undefined,
                // HEL-255 — Table display config rides the same single PATCH;
                // its `patch` fields are `undefined` unless the user changed
                // them, so untouched panels persist nothing extra.
                tableDisplay: panel.type === "table" ? tableDisplay.patch : undefined,
                // HEL-248 — Chart per-type display options ride the same single
                // PATCH; `undefined` when the Display section was untouched, so
                // an untouched chart panel persists nothing extra.
                chartOptions: panel.type === "chart" ? chartDisplay.patch : undefined,
              }),
            ).unwrap();
            return { ok: true };
          } catch {
            const error = "Failed to save data binding.";
            setSaveError(error);
            return { ok: false, error };
          }
        },
      }),
      [
        aggField,
        aggFn,
        aggregationDirty,
        chartDisplay,
        currentAggregation,
        dataDirty,
        dispatch,
        fieldMapping,
        initialAggField,
        initialAggFn,
        initialFieldMapping,
        initialRefreshInterval,
        initialTypeId,
        initialAggYField,
        labelState,
        panel.id,
        panel.type,
        refreshInterval,
        selectedTypeId,
        tableDisplay,
        unitState,
      ],
    );

    const slots = PANEL_SLOTS[panel.type];
    const filteredDataTypes = pipelineOutputDataTypes.filter((dt) =>
      dt.name.toLowerCase().includes(typeSearch.toLowerCase()),
    );

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Data</h3>
        <DataTypePicker
          selectedType={selectedType}
          typeSearch={typeSearch}
          onTypeSearchChange={setTypeSearch}
          dataTypesStatus={dataTypesStatus}
          filteredDataTypes={filteredDataTypes}
          selectedTypeId={selectedTypeId}
          onSelect={(dataTypeId) => {
            setSelectedTypeId(dataTypeId);
            setTypeSearch("");
          }}
          onClear={() => {
            setSelectedTypeId(null);
            setFieldMapping({});
            setTypeSearch("");
          }}
        />

        {selectedType && panel.type !== "metric" && slots.length > 0 && (
          <FieldMappingSlots
            slots={slots}
            fieldMapping={fieldMapping}
            onFieldChange={(slotKey, v) =>
              setFieldMapping((prev) => ({
                ...prev,
                [slotKey]: v,
              }))
            }
            fieldOptions={fieldOptions(selectedType)}
          />
        )}

        {/* HEL-243 — metric replaces the generic field-mapping loop + the
            separate Aggregation section with one unified Value control
            (field + Reduce) and Label/Unit bind-or-literal controls, so
            `fieldMapping.value` and `aggregation` can never disagree (see
            design.md Decision 1) and label/unit literals are editable
            post-creation (see design.md Decision 2/3). */}
        {selectedType && panel.type === "metric" && (
          <MetricBindingFields
            fieldOptions={aggFieldOptions(selectedType)}
            fieldValue={aggField}
            onFieldChange={setAggField}
            reduceValue={aggFn}
            onReduceChange={setAggFn}
            labelState={labelState}
            unitState={unitState}
          />
        )}

        {selectedType && panel.type === "chart" && (
          <ChartAggregationFields
            fieldOptions={aggFieldOptions(selectedType)}
            groupByValue={aggField}
            onGroupByChange={setAggField}
            valueFieldValue={aggYField}
            onValueFieldChange={setAggYField}
            aggFnValue={aggFn}
            onAggFnChange={setAggFn}
          />
        )}

        {/* HEL-248 — Chart per-type Display controls. Rendered for every chart
            panel (independent of a data binding, except scatter's field selects
            which need bound columns); swaps on the live chart type. */}
        {panel.type === "chart" && (
          <ChartDisplayFields
            chartType={chartType}
            line={chartDisplay.line}
            onLineChange={chartDisplay.setLine}
            bar={chartDisplay.bar}
            onBarChange={chartDisplay.setBar}
            pie={chartDisplay.pie}
            onPieChange={chartDisplay.setPie}
            scatter={chartDisplay.scatter}
            onScatterChange={chartDisplay.setScatter}
            fieldOptions={selectedType ? fieldOptions(selectedType) : []}
            isBound={selectedType !== null}
          />
        )}

        {/* HEL-255 — Table display controls (density always; Columns list only
            when a DataType is bound, since `columns` is empty when unbound). */}
        {panel.type === "table" && (
          <TableDisplayFields
            density={tableDisplay.density}
            onDensityChange={tableDisplay.setDensity}
            columns={tableDisplay.columns}
            onToggleVisible={tableDisplay.toggleVisible}
            onMoveUp={tableDisplay.moveUp}
            onMoveDown={tableDisplay.moveDown}
            hasStoredWidths={tableDisplay.hasStoredWidths}
            resetWidthsPending={tableDisplay.resetWidthsPending}
            onResetWidths={tableDisplay.requestResetWidths}
          />
        )}

        <div className="panel-detail-modal__data-section">
          <label className="panel-detail-modal__data-label" htmlFor="refresh-interval">
            Refresh interval
          </label>
          <Select
            ariaLabel="Refresh interval"
            value={refreshInterval === null ? "" : String(refreshInterval)}
            onChange={(v) => setRefreshInterval(v === "" ? null : Number(v))}
            options={[
              { value: "", label: "Manual" },
              { value: "30", label: "30s" },
              { value: "60", label: "1m" },
              { value: "300", label: "5m" },
              { value: "900", label: "15m" },
              { value: "3600", label: "1h" },
            ]}
          />
        </div>

        <InlineError error={saveError} />
      </>
    );
  },
);
