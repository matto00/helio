// HEL-1190 design.md D1-D4 (task 4.1) — renders a panel's author-configured, non-orphaned
// `OutputControlSpec[]` for a viewer, one control per `kind`. Presentational only: the caller
// (`useViewerControls`, per render path) owns the URL-backed value state; this component reads
// the CURRENT value per control and reports a change/clear back up. Reused identically by every
// render path (desktop grid, mobile stack, fullscreen, detail modal, public viewer) — the same
// component instance shape, fed a different `fetchDistinctValues` implementation per D1's
// public/authenticated split (task 4.1's own stated shape).

import { useEffect, useId, useMemo, useState } from "react";

import "./OutputViewerControlBar.css";
import { Select, TextField } from "../../../shared/ui/index";
import type { SelectOption } from "../../../shared/ui/index";
import {
  isDateRangePresetToken,
  parseDateRangeRaw,
  parseNumericRangeRaw,
  encodeDateRangeValue,
  encodeNumericRangeValue,
  type DateRangePresetToken,
} from "../state/viewerControlValues";
import type { OutputControlSpec } from "../types/panel";

export interface DistinctValueOption {
  value: string;
  count: number;
}

export interface OutputViewerControlBarProps {
  controls: OutputControlSpec[];
  /** controlId -> the value currently in effect (`useViewerControls`' own `values`). */
  values: Record<string, string | undefined>;
  onChange: (controlId: string, raw: string) => void;
  onClear: (controlId: string) => void;
  /** Resolves a `dropdown` control's options — the caller supplies the public- or authenticated-
   *  route implementation (design.md D1's reuse); this component is agnostic to which. */
  fetchDistinctValues: (column: string) => Promise<DistinctValueOption[]>;
}

const DATE_PRESET_OPTIONS: SelectOption[] = [
  { value: "", label: "All time" },
  { value: "last7d", label: "Last 7 days" },
  { value: "last30d", label: "Last 30 days" },
  { value: "thisQuarter", label: "This quarter" },
  { value: "custom", label: "Custom range" },
];

export function OutputViewerControlBar({
  controls,
  values,
  onChange,
  onClear,
  fetchDistinctValues,
}: OutputViewerControlBarProps) {
  // spec.md Requirement 1 — an orphaned control is never rendered to a viewer, even though it
  // still shows (as orphaned) in the author's own editor.
  const visibleControls = useMemo(() => controls.filter((c) => !c.orphaned), [controls]);

  if (visibleControls.length === 0) return null;

  return (
    <div className="output-viewer-control-bar" role="group" aria-label="Panel controls">
      {visibleControls.map((control) => (
        <OutputViewerControl
          key={control.id}
          control={control}
          value={values[control.id]}
          onChange={(raw) => onChange(control.id, raw)}
          onClear={() => onClear(control.id)}
          fetchDistinctValues={fetchDistinctValues}
        />
      ))}
    </div>
  );
}

interface ControlProps {
  control: OutputControlSpec;
  value: string | undefined;
  onChange: (raw: string) => void;
  onClear: () => void;
  fetchDistinctValues: (column: string) => Promise<DistinctValueOption[]>;
}

function OutputViewerControl({
  control,
  value,
  onChange,
  onClear,
  fetchDistinctValues,
}: ControlProps) {
  if (control.kind === "text")
    return <TextControl control={control} value={value} onChange={onChange} onClear={onClear} />;
  if (control.kind === "dropdown")
    return (
      <DropdownControl
        control={control}
        value={value}
        onChange={onChange}
        onClear={onClear}
        fetchDistinctValues={fetchDistinctValues}
      />
    );
  if (control.kind === "numeric-range")
    return (
      <NumericRangeControl control={control} value={value} onChange={onChange} onClear={onClear} />
    );
  return <DateRangeControl control={control} value={value} onChange={onChange} onClear={onClear} />;
}

function TextControl({
  control,
  value,
  onChange,
  onClear,
}: Omit<ControlProps, "fetchDistinctValues">) {
  const inputId = useId();
  return (
    <div className="output-viewer-control-bar__control">
      <label htmlFor={inputId} className="output-viewer-control-bar__label">
        {control.label}
      </label>
      <TextField
        id={inputId}
        className="output-viewer-control-bar__text-input"
        value={value ?? ""}
        onChange={(e) => (e.target.value === "" ? onClear() : onChange(e.target.value))}
        placeholder="Search…"
      />
    </div>
  );
}

function DropdownControl({ control, value, onChange, onClear, fetchDistinctValues }: ControlProps) {
  const [options, setOptions] = useState<SelectOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchDistinctValues(control.column)
      .then((values) => {
        if (!cancelled) setOptions(values.map((v) => ({ value: v.value, label: v.value })));
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [control.column, fetchDistinctValues]);

  return (
    <div className="output-viewer-control-bar__control">
      <span className="output-viewer-control-bar__label" aria-hidden="true">
        {control.label}
      </span>
      <Select
        value={value ?? ""}
        onChange={(next) => (next === "" ? onClear() : onChange(next))}
        options={[{ value: "", label: "All" }, ...options]}
        ariaLabel={control.label}
        placeholder="All"
      />
    </div>
  );
}

function NumericRangeControl({
  control,
  value,
  onChange,
  onClear,
}: Omit<ControlProps, "fetchDistinctValues">) {
  const parsed = value !== undefined ? parseNumericRangeRaw(value) : undefined;
  const min = parsed?.min ?? null;
  const max = parsed?.max ?? null;
  const minId = useId();
  const maxId = useId();

  function commit(nextMin: number | null, nextMax: number | null) {
    if (nextMin === null && nextMax === null) {
      onClear();
      return;
    }
    onChange(encodeNumericRangeValue({ min: nextMin, max: nextMax }));
  }

  return (
    <div className="output-viewer-control-bar__control output-viewer-control-bar__control--range">
      <span className="output-viewer-control-bar__label" id={`${minId}-legend`}>
        {control.label}
      </span>
      <div className="output-viewer-control-bar__range-inputs">
        <label htmlFor={minId} className="sr-only">
          {control.label} minimum
        </label>
        <TextField
          id={minId}
          type="number"
          className="output-viewer-control-bar__number-input"
          value={min ?? ""}
          placeholder="Min"
          onChange={(e) => commit(e.target.value === "" ? null : Number(e.target.value), max)}
        />
        <label htmlFor={maxId} className="sr-only">
          {control.label} maximum
        </label>
        <TextField
          id={maxId}
          type="number"
          className="output-viewer-control-bar__number-input"
          value={max ?? ""}
          placeholder="Max"
          onChange={(e) => commit(min, e.target.value === "" ? null : Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function DateRangeControl({
  control,
  value,
  onChange,
  onClear,
}: Omit<ControlProps, "fetchDistinctValues">) {
  const parsed = value !== undefined ? parseDateRangeRaw(value) : undefined;
  const preset: DateRangePresetToken | "custom" | "" =
    parsed === undefined ? "" : "preset" in parsed ? parsed.preset : "custom";
  const from = parsed !== undefined && !("preset" in parsed) ? (parsed.from ?? "") : "";
  const to = parsed !== undefined && !("preset" in parsed) ? (parsed.to ?? "") : "";
  const fromId = useId();
  const toId = useId();

  function handlePresetChange(next: string) {
    if (next === "") {
      onClear();
    } else if (next === "custom") {
      onChange(encodeDateRangeValue({ from: null, to: null }));
    } else if (isDateRangePresetToken(next)) {
      onChange(encodeDateRangeValue({ preset: next }));
    }
  }

  return (
    <div className="output-viewer-control-bar__control output-viewer-control-bar__control--range">
      <span className="output-viewer-control-bar__label" aria-hidden="true">
        {control.label}
      </span>
      <Select
        value={preset}
        onChange={handlePresetChange}
        options={DATE_PRESET_OPTIONS}
        ariaLabel={control.label}
        placeholder="All time"
      />
      {preset === "custom" && (
        <div className="output-viewer-control-bar__range-inputs">
          <label htmlFor={fromId} className="sr-only">
            {control.label} from
          </label>
          <TextField
            id={fromId}
            type="date"
            className="output-viewer-control-bar__date-input"
            value={from.slice(0, 10)}
            onChange={(e) =>
              onChange(
                encodeDateRangeValue({
                  from: e.target.value === "" ? null : new Date(e.target.value).toISOString(),
                  to: to || null,
                }),
              )
            }
          />
          <label htmlFor={toId} className="sr-only">
            {control.label} to
          </label>
          <TextField
            id={toId}
            type="date"
            className="output-viewer-control-bar__date-input"
            value={to.slice(0, 10)}
            onChange={(e) =>
              onChange(
                encodeDateRangeValue({
                  from: from || null,
                  to: e.target.value === "" ? null : new Date(e.target.value).toISOString(),
                }),
              )
            }
          />
        </div>
      )}
    </div>
  );
}
