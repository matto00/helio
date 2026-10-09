// AggregateConfig — config editor for the "aggregate" pipeline op.
// Renders a group-by section (field dropdown rows, add/remove) and an aggregations
// section (alias text input, fn dropdown, field dropdown, add/remove).
// Inline warning shown when an aggregation field references a name not in analyzeSchema.
// Follows the same props-driven pattern as FilterConfig / ComputeFieldConfig:
// the parent (StepCard) owns state and calls onChange with serialized config JSON.

import { useId, useState } from "react";

import type { SchemaField } from "../../types/pipelineStep";
import { FormField, Select, TextField } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { TriangleAlert, X } from "lucide-react";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";

export interface AggregateGroupByField {
  name: string;
  type: string;
}

export interface AggregationRow {
  alias: string;
  fn: string;
  field: string;
  /** Percentile position (0-100); present only when fn is "percentile". */
  p?: number;
}

export interface AggregateConfigValue {
  groupBy: AggregateGroupByField[];
  aggregations: AggregationRow[];
}

export const AGG_FNS = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "median",
  "percentile",
  "count_distinct",
] as const;

/** Default percentile position seeded when a row is switched to `percentile`. */
const DEFAULT_PERCENTILE = 50;

/** Parses a percentile draft; null when blank, non-numeric or outside 0-100. */
function parsePercentile(draft: string): number | null {
  if (draft.trim() === "") return null;
  const n = Number(draft);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** Schema types a new aggregation should default its field to (HEL sweep
 *  F-129) — mirrors FilterConfig's own NUMERIC_TYPES set for value-input
 *  type-awareness. */
const NUMERIC_TYPES = new Set(["number", "integer", "long", "double", "float"]);

export const FN_HINTS: Record<(typeof AGG_FNS)[number], string> = {
  sum: "Sums numeric values; ignores nulls",
  avg: "Averages numeric values; ignores nulls",
  min: "Minimum numeric value; ignores nulls and non-numeric",
  max: "Maximum numeric value; ignores nulls and non-numeric",
  count: "Counts non-null values in the field",
  median:
    "Middle numeric value; mean of the two middle values for an even count; ignores nulls and non-numeric",
  percentile: "Value at percentile p (0-100), linearly interpolated; ignores nulls and non-numeric",
  count_distinct: "Counts distinct non-null values in the field",
};

interface AggregateConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: AggregateConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — field selectors. */
  analyzeSchema: SchemaField[];
  /** Column names derived from analyzeSchema — used for the aggregation field dropdown. */
  analyzeColumns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: AggregateConfigValue) => void;
}

export function AggregateConfig({
  config,
  analyzeSchema,
  analyzeColumns,
  onChange,
}: AggregateConfigProps) {
  const [blurredAliasRows, setBlurredAliasRows] = useState<Set<number>>(new Set());
  // In-progress `p` text per row. An invalid draft (blank / non-numeric / outside 0-100) stays
  // here and is never emitted, so the editor cannot save a config the server would reject.
  // One useId per component, suffixed per row (hooks cannot run inside the map).
  const idBase = useId();
  const [pDrafts, setPDrafts] = useState<Record<number, string>>({});

  function emit(next: AggregateConfigValue) {
    onChange(next);
  }

  function handleAddGroupByRow() {
    // HEL sweep F-129: default to the first schema field not already used by
    // another group-by row — duplicating a partition key is never useful and
    // previously happened by default (every new row picked analyzeSchema[0]
    // regardless of what earlier rows already held). Leave the new row
    // unselected once every field is already spoken for rather than forcing
    // a duplicate.
    const usedNames = new Set(config.groupBy.map((g) => g.name));
    const defaultField = analyzeSchema.find((f) => !usedNames.has(f.name)) ?? {
      name: "",
      type: "string",
    };
    emit({
      ...config,
      groupBy: [...config.groupBy, { name: defaultField.name, type: defaultField.type }],
    });
  }

  function handleGroupByFieldChange(index: number, name: string) {
    const schemaField = analyzeSchema.find((f) => f.name === name);
    const type = schemaField?.type ?? "string";
    const groupBy = config.groupBy.map((g, i) => (i === index ? { name, type } : g));
    emit({ ...config, groupBy });
  }

  function handleRemoveGroupByRow(index: number) {
    const groupBy = config.groupBy.filter((_, i) => i !== index);
    emit({ ...config, groupBy });
  }

  function handleAddAggregation() {
    // HEL sweep F-129: default to the first numeric-typed schema field
    // (sum/avg/min/max only make sense on numbers) rather than
    // unconditionally analyzeColumns[0], which could be e.g. a string
    // "region" column. Leave the field unselected — the picker's placeholder
    // — when no numeric field is available, instead of guessing.
    const numericField = analyzeSchema.find((f) => NUMERIC_TYPES.has(f.type));
    emit({
      ...config,
      aggregations: [
        ...config.aggregations,
        { alias: "", fn: "sum", field: numericField?.name ?? "" },
      ],
    });
  }

  function handleAggregationChange(index: number, updated: AggregationRow) {
    const aggregations = config.aggregations.map((a, i) => (i === index ? updated : a));
    emit({ ...config, aggregations });
  }

  function handleFnChange(index: number, agg: AggregationRow, fn: string) {
    setPDrafts((prev) => {
      const { [index]: _dropped, ...rest } = prev;
      return rest;
    });
    const { p: _oldP, ...withoutP } = agg;
    handleAggregationChange(
      index,
      fn === "percentile" ? { ...withoutP, fn, p: DEFAULT_PERCENTILE } : { ...withoutP, fn },
    );
  }

  function handlePChange(index: number, agg: AggregationRow, draft: string) {
    const parsed = parsePercentile(draft);
    if (parsed === null) {
      setPDrafts((prev) => ({ ...prev, [index]: draft }));
      return;
    }
    setPDrafts((prev) => {
      const { [index]: _dropped, ...rest } = prev;
      return rest;
    });
    handleAggregationChange(index, { ...agg, p: parsed });
  }

  function handleRemoveAggregation(index: number) {
    setPDrafts({});
    const aggregations = config.aggregations.filter((_, i) => i !== index);
    emit({ ...config, aggregations });
  }

  const analyzeFieldNames = new Set(analyzeColumns);

  return (
    <div className="pipeline-detail-page__aggregate-config">
      {/* ── Group-by section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Group by</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Group-by fields define the partition keys. Each unique combination becomes one output row.
        </p>

        <div className="pipeline-detail-page__aggregate-groupby-rows">
          {config.groupBy.map((g, index) => (
            <div key={index} className="pipeline-detail-page__aggregate-groupby-row">
              <Select
                ariaLabel={`Group-by field ${index + 1}`}
                value={g.name}
                placeholder="— select field —"
                options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                onChange={(next) => handleGroupByFieldChange(index, next)}
              />
              <button
                type="button"
                className="pipeline-detail-page__row-remove-btn"
                aria-label={`Remove group-by field ${index + 1}`}
                onClick={() => handleRemoveGroupByRow(index)}
              >
                <X size={ICON_SIZE.sm} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddGroupByRow}
        >
          + Add group-by field
        </button>
      </div>

      {/* ── Aggregations section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Aggregations</span>

        <div className="pipeline-detail-page__aggregate-agg-rows">
          {config.aggregations.map((agg, index) => {
            const fieldMissing = agg.field !== "" && !analyzeFieldNames.has(agg.field);
            // Stored configs may carry any case ("SUM", "PERCENTILE"); the backend lowercases
            // fn, so the editor matches on the lowercase key and leaves the stored value alone.
            const fnKey = agg.fn.toLowerCase();
            const pId = `${idBase}-p-${index}`;
            const pErrorId = `${idBase}-p-err-${index}`;
            const pError =
              pDrafts[index] !== undefined
                ? "Percentile p must be a number between 0 and 100"
                : null;
            const aliasBlurred = blurredAliasRows.has(index);
            const showAliasError = aliasBlurred && agg.alias === "";
            return (
              <div key={index} className="pipeline-detail-page__aggregate-agg-row">
                {/* Alias input */}
                <TextField
                  aria-label={`Alias for aggregation ${index + 1}`}
                  placeholder="alias"
                  value={agg.alias}
                  onChange={(e) =>
                    handleAggregationChange(index, { ...agg, alias: e.target.value })
                  }
                  onBlur={() => setBlurredAliasRows((prev) => new Set(prev).add(index))}
                />
                {showAliasError && <InlineError error="Output name required" />}

                {/* Function dropdown */}
                <Select
                  ariaLabel={`Function for aggregation ${index + 1}`}
                  value={fnKey}
                  options={AGG_FNS.map((fn) => ({ value: fn, label: fn }))}
                  onChange={(next) => handleFnChange(index, agg, next)}
                />
                <span className="pipeline-detail-page__aggregate-fn-hint">
                  {FN_HINTS[fnKey as (typeof AGG_FNS)[number]]}
                </span>

                {fnKey === "percentile" && (
                  <FormField
                    label={`Percentile p (row ${index + 1})`}
                    htmlFor={pId}
                    error={pError}
                    errorId={pErrorId}
                    className="pipeline-detail-page__aggregate-p-field"
                  >
                    <TextField
                      id={pId}
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      placeholder="p (0-100)"
                      aria-invalid={pError ? true : undefined}
                      aria-describedby={pError ? pErrorId : undefined}
                      value={pDrafts[index] ?? String(agg.p ?? "")}
                      onChange={(e) => handlePChange(index, agg, e.target.value)}
                    />
                  </FormField>
                )}

                {/* Field dropdown */}
                <Select
                  ariaLabel={`Field for aggregation ${index + 1}`}
                  value={agg.field}
                  placeholder="— select field —"
                  options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                  onChange={(next) => handleAggregationChange(index, { ...agg, field: next })}
                />

                {/* Remove button */}
                <button
                  type="button"
                  className="pipeline-detail-page__row-remove-btn"
                  aria-label={`Remove aggregation ${index + 1}`}
                  onClick={() => handleRemoveAggregation(index)}
                >
                  <X size={ICON_SIZE.sm} />
                </button>

                {/* Inline warning: field not found in inputSchema */}
                {fieldMissing && (
                  <span
                    className="pipeline-detail-page__filter-warning"
                    role="alert"
                    aria-label={`Warning: field "${agg.field}" not in schema`}
                  >
                    <TriangleAlert size={ICON_SIZE.sm} /> Field &quot;{agg.field}&quot; not found in
                    input schema
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddAggregation}
        >
          + Add aggregation
        </button>
      </div>
    </div>
  );
}
