import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Select, TextField, type SelectOption } from "../../../../shared/ui/index";
import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../../dataTypes/state/dataTypesSlice";
import type { DataType } from "../../../dataTypes/types/dataType";
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
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";

const AGG_FN_OPTIONS: { value: AggFn; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];

function isAggFn(value: string): value is AggFn {
  return (
    value === "count" || value === "sum" || value === "avg" || value === "min" || value === "max"
  );
}

/** Field + computed-field options for a selected DataType, shared by the
 *  field-mapping and aggregation sections. */
function fieldOptions(dataType: DataType): SelectOption[] {
  return [
    ...dataType.fields.map((f) => ({ value: f.name, label: f.name })),
    ...(dataType.computedFields ?? []).map((cf) => ({
      value: cf.name,
      label: `${cf.name} (computed)`,
    })),
  ];
}

/** Same as `fieldOptions`, plus an explicit "— None —" (empty-value) option.
 *  Unlike field mapping (whose slots always carry a meaning once a DataType
 *  is picked), an aggregation spec is fully optional and the user needs a
 *  selectable way to clear a previously-configured field — hence the
 *  explicit clear option here only. */
function aggFieldOptions(dataType: DataType): SelectOption[] {
  return [{ value: "", label: "— None —" }, ...fieldOptions(dataType)];
}

interface BindingEditorProps {
  panel: MetricPanel | ChartPanel | TablePanel;
  /** Optional poll interval persisted only on the frontend until CS3 cleanup. */
  initialRefreshInterval: number | null;
  onDirtyChange: DirtyChangeCallback;
}

/** Per-panel typed binding (`dataTypeId` + `fieldMapping`) editor used by the
 *  three bound-capable subtypes (metric, chart, table). The previous flat-
 *  field PATCH path still flows through `updatePanelBinding`; this editor
 *  just narrows the inputs from the typed config and pushes them back via
 *  the same thunk so the wire shape ends up as a typed PATCH on `config`. */
export const BindingEditor = forwardRef<PanelEditorHandle, BindingEditorProps>(
  function BindingEditor({ panel, initialRefreshInterval, onDirtyChange }, ref) {
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
    const initialAggField = initialMetricAgg?.value ?? initialChartAgg?.groupBy ?? "";
    const initialAggFn = initialMetricAgg?.agg ?? initialChartAgg?.agg ?? "";
    const initialAggYField = initialChartAgg?.yField ?? "";

    const [selectedTypeId, setSelectedTypeId] = useState<string | null>(initialTypeId);
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>(initialFieldMapping);
    const [refreshInterval, setRefreshInterval] = useState<number | null>(initialRefreshInterval);
    const [typeSearch, setTypeSearch] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);
    const [aggField, setAggField] = useState<string>(initialAggField);
    const [aggFn, setAggFn] = useState<string>(initialAggFn);
    const [aggYField, setAggYField] = useState<string>(initialAggYField);

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
      aggregationDirty;

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
          setSaveError(null);
        },
        save: async () => {
          if (!dataDirty) return { ok: true };
          try {
            await dispatch(
              updatePanelBinding({
                panelId: panel.id,
                typeId: selectedTypeId,
                fieldMapping: Object.keys(fieldMapping).length > 0 ? fieldMapping : null,
                refreshInterval,
                // `undefined` when the aggregation section wasn't touched —
                // omits the key entirely so an untouched absent spec stays
                // absent (see `buildBindingPatch`).
                aggregation: aggregationDirty ? currentAggregation : undefined,
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
        aggregationDirty,
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
        panel.id,
        refreshInterval,
        selectedTypeId,
      ],
    );

    const selectedType = dataTypes.find((dt) => dt.id === selectedTypeId) ?? null;
    const slots = PANEL_SLOTS[panel.type];
    const filteredDataTypes = pipelineOutputDataTypes.filter((dt) =>
      dt.name.toLowerCase().includes(typeSearch.toLowerCase()),
    );

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Data</h3>
        <div className="panel-detail-modal__data-section">
          <span className="panel-detail-modal__data-label">Data type</span>
          {selectedType ? (
            <div className="panel-detail-modal__selected-type">
              <span className="panel-detail-modal__selected-type-name">{selectedType.name}</span>
              <span className="panel-detail-modal__type-count">
                {selectedType.fields.length} fields
              </span>
              <button
                type="button"
                className="panel-detail-modal__type-clear"
                aria-label="Clear selected data type"
                onClick={() => {
                  setSelectedTypeId(null);
                  setFieldMapping({});
                  setTypeSearch("");
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <>
              <TextField
                type="text"
                placeholder="Search data types…"
                value={typeSearch}
                onChange={(e) => setTypeSearch(e.target.value)}
                aria-label="Search data types"
              />
              {dataTypesStatus === "loading" ? (
                <p className="panel-detail-modal__type-hint">Loading…</p>
              ) : filteredDataTypes.length === 0 ? (
                <p className="panel-detail-modal__type-hint">No data types found.</p>
              ) : (
                <ul
                  className="panel-detail-modal__type-list"
                  role="listbox"
                  aria-label="Data types"
                >
                  {filteredDataTypes.map((dt) => (
                    <li
                      key={dt.id}
                      role="option"
                      aria-selected={dt.id === selectedTypeId}
                      className="panel-detail-modal__type-option"
                      onClick={() => {
                        setSelectedTypeId(dt.id);
                        setTypeSearch("");
                      }}
                    >
                      <span className="panel-detail-modal__selected-type-name">{dt.name}</span>
                      <span className="panel-detail-modal__type-count">
                        {dt.fields.length} fields
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <Link to="/pipelines" className="panel-detail-modal__source-link">
            Create a pipeline →
          </Link>
        </div>

        {selectedType && slots.length > 0 && (
          <div className="panel-detail-modal__data-section">
            <span className="panel-detail-modal__data-label">Field mapping</span>
            {slots.map((slot) => (
              <div key={slot.key} className="panel-detail-modal__mapping-row">
                <label className="panel-detail-modal__mapping-label" htmlFor={`slot-${slot.key}`}>
                  {slot.label}
                </label>
                <Select
                  ariaLabel={`${slot.label} field`}
                  value={fieldMapping[slot.key] ?? ""}
                  onChange={(v) =>
                    setFieldMapping((prev) => ({
                      ...prev,
                      [slot.key]: v,
                    }))
                  }
                  placeholder="— None —"
                  options={fieldOptions(selectedType)}
                />
              </div>
            ))}
          </div>
        )}

        {selectedType && (panel.type === "metric" || panel.type === "chart") && (
          <div className="panel-detail-modal__data-section">
            <span className="panel-detail-modal__data-label">Aggregation</span>
            {panel.type === "chart" && (
              <div className="panel-detail-modal__mapping-row">
                <label className="panel-detail-modal__mapping-label" htmlFor="agg-group-by">
                  Group by
                </label>
                <Select
                  ariaLabel="Group by field"
                  value={aggField}
                  onChange={setAggField}
                  placeholder="— None —"
                  options={aggFieldOptions(selectedType)}
                />
              </div>
            )}
            <div className="panel-detail-modal__mapping-row">
              <label className="panel-detail-modal__mapping-label" htmlFor="agg-field">
                {panel.type === "metric" ? "Field" : "Value field"}
              </label>
              <Select
                ariaLabel={
                  panel.type === "metric" ? "Aggregation field" : "Aggregation value field"
                }
                value={panel.type === "metric" ? aggField : aggYField}
                onChange={panel.type === "metric" ? setAggField : setAggYField}
                placeholder="— None —"
                options={aggFieldOptions(selectedType)}
              />
            </div>
            <div className="panel-detail-modal__mapping-row">
              <label className="panel-detail-modal__mapping-label" htmlFor="agg-fn">
                Function
              </label>
              <Select
                ariaLabel="Aggregation function"
                value={aggFn}
                onChange={setAggFn}
                placeholder="— None —"
                options={[{ value: "", label: "— None —" }, ...AGG_FN_OPTIONS]}
              />
            </div>
          </div>
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
