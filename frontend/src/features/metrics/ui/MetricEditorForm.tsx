// Shared create/edit form for a metric (HEL-553 tasks 2.4). Used inline
// inside `CreateMetricModal` (create) and `MetricDetailPage` (edit) — one
// component owns the field set + validation-error surfacing so the two
// flows can never drift (design.md D3/D4).

import { useEffect, useState, type FormEvent } from "react";

import { InlineError } from "../../../shared/chrome/InlineError";
import { Select, Textarea, TextField, Toggle } from "../../../shared/ui/index";
import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../dataTypes/state/dataTypesSlice";
import { DataTypePicker } from "../../panels/ui/editors/DataTypePicker";
import { fieldOptions } from "../../panels/ui/editors/fieldOptions";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { createMetric, updateMetric } from "../state/metricsSlice";
import type { Metric, MetricFormat, UpdateMetricRequest } from "../types/metric";
import { AllowedDimensionsPicker } from "./AllowedDimensionsPicker";
import "./MetricEditorForm.css";

const AGGREGATION_OPTIONS: { value: string; label: string }[] = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "count", label: "Count" },
  { value: "countDistinct", label: "Count distinct" },
];

const EMPTY_FORMAT: MetricFormat = { unit: null, decimals: null, prefix: null, suffix: null };

function formatEqual(a: MetricFormat, b: MetricFormat): boolean {
  return (
    (a.unit ?? null) === (b.unit ?? null) &&
    (a.decimals ?? null) === (b.decimals ?? null) &&
    (a.prefix ?? null) === (b.prefix ?? null) &&
    (a.suffix ?? null) === (b.suffix ?? null)
  );
}

function dimensionsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

interface MetricEditorFormProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`; ignored for `mode: "create"`. */
  metric?: Metric | null;
  onSaved: (metric: Metric) => void;
  onCancel: () => void;
}

export function MetricEditorForm({ mode, metric, onSaved, onCancel }: MetricEditorFormProps) {
  const dispatch = useAppDispatch();
  const dataTypes = useAppSelector((state) => state.dataTypes.items);
  const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
  const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

  useEffect(() => {
    if (dataTypesStatus === "idle") {
      void dispatch(fetchDataTypes());
    }
  }, [dataTypesStatus, dispatch]);

  const initialName = metric?.name ?? "";
  const initialDescription = metric?.description ?? "";
  const initialTypeId = metric?.dataTypeId ?? null;
  const initialMeasureField = metric?.measureField ?? "";
  const initialAggregation = metric?.aggregation ?? "sum";
  const initialAllowedDimensions = metric?.allowedDimensions ?? [];
  const initialFormat = metric?.format ?? EMPTY_FORMAT;
  const initialDeprecated = metric?.deprecated ?? false;

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(initialTypeId);
  const [typeSearch, setTypeSearch] = useState("");
  const [measureField, setMeasureField] = useState(initialMeasureField);
  const [aggregation, setAggregation] = useState(initialAggregation);
  const [allowedDimensions, setAllowedDimensions] = useState<string[]>(initialAllowedDimensions);
  const [unit, setUnit] = useState(initialFormat.unit ?? "");
  const [decimals, setDecimals] = useState(
    initialFormat.decimals !== null && initialFormat.decimals !== undefined
      ? String(initialFormat.decimals)
      : "",
  );
  const [prefix, setPrefix] = useState(initialFormat.prefix ?? "");
  const [suffix, setSuffix] = useState(initialFormat.suffix ?? "");
  const [deprecated, setDeprecated] = useState(initialDeprecated);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create mode only: picking a different DataType invalidates the measure
  // field / allowed dimensions chosen against the previous one. "Adjusting
  // state when a prop changes" during render, mirroring `BindingEditor.tsx`'s
  // HEL-624 scatter-clear pattern rather than a setState-in-useEffect. Edit
  // mode never re-triggers this — its DataType is fixed (read-only below).
  const [prevTypeId, setPrevTypeId] = useState(selectedTypeId);
  if (mode === "create" && selectedTypeId !== prevTypeId) {
    setPrevTypeId(selectedTypeId);
    setMeasureField("");
    setAllowedDimensions([]);
  }

  const selectedType = dataTypes.find((dt) => dt.id === selectedTypeId) ?? null;
  const availableFieldOptions = selectedType ? fieldOptions(selectedType) : [];
  const filteredDataTypes = pipelineOutputDataTypes.filter((dt) =>
    dt.name.toLowerCase().includes(typeSearch.toLowerCase()),
  );

  const currentFormat: MetricFormat = {
    unit: unit.trim() ? unit.trim() : null,
    decimals: decimals.trim() ? Number(decimals) : null,
    prefix: prefix.trim() ? prefix.trim() : null,
    suffix: suffix.trim() ? suffix.trim() : null,
  };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError("Metric name is required.");
      return;
    }
    if (!selectedTypeId) {
      setFormError("A data type is required.");
      return;
    }
    if (!measureField) {
      setFormError("A measure field is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "create") {
        const created = await dispatch(
          createMetric({
            dataTypeId: selectedTypeId,
            name: name.trim(),
            description: description.trim() ? description.trim() : undefined,
            measureField,
            aggregation,
            allowedDimensions,
            format: currentFormat,
          }),
        ).unwrap();
        onSaved(created);
      } else if (metric) {
        // PATCH only the fields that actually changed — the backend's
        // absent-vs-null convention treats an omitted key as "unchanged".
        const request: UpdateMetricRequest = {};
        if (name.trim() !== initialName) request.name = name.trim();
        if (description !== initialDescription) {
          request.description = description.trim() ? description.trim() : null;
        }
        if (measureField !== initialMeasureField) request.measureField = measureField;
        if (aggregation !== initialAggregation) request.aggregation = aggregation;
        if (!dimensionsEqual(allowedDimensions, initialAllowedDimensions)) {
          request.allowedDimensions = allowedDimensions;
        }
        if (!formatEqual(currentFormat, initialFormat)) request.format = currentFormat;
        if (deprecated !== initialDeprecated) request.deprecated = deprecated;

        const updated = await dispatch(updateMetric({ id: metric.id, request })).unwrap();
        onSaved(updated);
      }
    } catch (err: unknown) {
      setFormError(typeof err === "string" ? err : "Failed to save metric.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="metric-editor-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="metric-editor-form__field">
        <label className="metric-editor-form__label" htmlFor="metric-name">
          Name
        </label>
        <TextField
          id="metric-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Total Revenue"
          aria-label="Metric name"
        />
        {/* AC: the backend's 400 (empty name) / 422 (binding-shape) message is
            shown inline near the name field, without losing in-progress edits. */}
        <InlineError error={formError} />
      </div>

      <div className="metric-editor-form__field">
        <label className="metric-editor-form__label" htmlFor="metric-description">
          Description
        </label>
        <Textarea
          id="metric-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          aria-label="Metric description"
        />
      </div>

      <div className="metric-editor-form__field">
        <span className="metric-editor-form__label">Data type</span>
        {mode === "edit" ? (
          <p className="metric-editor-form__readonly-type">
            {selectedType?.name ?? metric?.dataTypeId}{" "}
            <span className="metric-editor-form__hint">(cannot be changed)</span>
          </p>
        ) : (
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
              setTypeSearch("");
            }}
          />
        )}
      </div>

      <div className="metric-editor-form__field">
        <span className="metric-editor-form__label">Measure field</span>
        <Select
          ariaLabel="Measure field"
          value={measureField}
          onChange={setMeasureField}
          options={availableFieldOptions}
          placeholder="Select a field…"
          disabled={!selectedType}
        />
      </div>

      <div className="metric-editor-form__field">
        <span className="metric-editor-form__label">Aggregation</span>
        <Select
          ariaLabel="Aggregation"
          value={aggregation}
          onChange={setAggregation}
          options={AGGREGATION_OPTIONS}
        />
      </div>

      <div className="metric-editor-form__field">
        <span className="metric-editor-form__label">Allowed dimensions</span>
        <AllowedDimensionsPicker
          options={availableFieldOptions}
          selected={allowedDimensions}
          onChange={setAllowedDimensions}
          disabled={!selectedType}
        />
      </div>

      <fieldset className="metric-editor-form__format">
        <legend className="metric-editor-form__label">Format</legend>
        <div className="metric-editor-form__format-row">
          <TextField
            aria-label="Format unit"
            placeholder="Unit (e.g. $)"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <TextField
            aria-label="Format decimals"
            type="number"
            placeholder="Decimals"
            value={decimals}
            onChange={(e) => setDecimals(e.target.value)}
          />
        </div>
        <div className="metric-editor-form__format-row">
          <TextField
            aria-label="Format prefix"
            placeholder="Prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
          <TextField
            aria-label="Format suffix"
            placeholder="Suffix"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
          />
        </div>
      </fieldset>

      {mode === "edit" && (
        <div className="metric-editor-form__field">
          <Toggle checked={deprecated} onChange={setDeprecated} label="Deprecated" />
        </div>
      )}

      <div className="metric-editor-form__actions">
        <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="ui-modal-btn ui-modal-btn--primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving…" : mode === "create" ? "Create metric" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
