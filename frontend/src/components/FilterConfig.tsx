// FilterConfig — multi-condition filter editor for the "filter" pipeline op.
// Renders a combinator toggle (AND/OR) and a list of condition rows.
// Each row: field dropdown (from analyzeSchema), operator dropdown (9 options), value input.
// Value input is hidden for unary operators (is null / is not null).
// Value input type adapts to field type: "number" for numeric types, "text" otherwise.

import type { SchemaField } from "../types/models";
import { Select, TextField } from "../shared/ui/index";

export interface FilterCondition {
  field: string;
  operator: string;
  value?: string;
}

export interface FilterConfigValue {
  combinator: "AND" | "OR";
  conditions: FilterCondition[];
}

export const FILTER_OPERATORS = [
  { value: "=", label: "=" },
  { value: "!=", label: "≠" },
  { value: ">", label: ">" },
  { value: ">=", label: "≥" },
  { value: "<", label: "<" },
  { value: "<=", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "is null", label: "is null" },
  { value: "is not null", label: "is not null" },
] as const;

const UNARY_OPERATORS = new Set(["is null", "is not null"]);
const NUMERIC_TYPES = new Set(["number", "integer", "long", "double", "float"]);

interface FilterConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: FilterConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema for type-aware value input. */
  analyzeSchema: SchemaField[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: FilterConfigValue) => void;
}

export function FilterConfig({ config, analyzeSchema, onChange }: FilterConfigProps) {
  function emit(next: FilterConfigValue) {
    onChange(next);
  }

  function handleCombinatorChange(combinator: "AND" | "OR") {
    emit({ ...config, combinator });
  }

  function handleConditionChange(index: number, updated: FilterCondition) {
    const conditions = config.conditions.map((c, i) => (i === index ? updated : c));
    emit({ ...config, conditions });
  }

  function handleAddCondition() {
    const defaultField = analyzeSchema.length > 0 ? analyzeSchema[0].name : "";
    const newCondition: FilterCondition = { field: defaultField, operator: "=", value: "" };
    emit({ ...config, conditions: [...config.conditions, newCondition] });
  }

  function handleRemoveCondition(index: number) {
    const conditions = config.conditions.filter((_, i) => i !== index);
    emit({ ...config, conditions });
  }

  return (
    <div className="pipeline-detail-page__filter-config">
      {/* Combinator toggle */}
      <div className="pipeline-detail-page__filter-combinator">
        <span className="pipeline-detail-page__filter-combinator-label">Match</span>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.combinator === "AND" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleCombinatorChange("AND")}
          aria-pressed={config.combinator === "AND"}
        >
          ALL (AND)
        </button>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.combinator === "OR" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleCombinatorChange("OR")}
          aria-pressed={config.combinator === "OR"}
        >
          ANY (OR)
        </button>
        <span className="pipeline-detail-page__filter-combinator-label">of the following</span>
      </div>

      {/* Condition rows */}
      <div className="pipeline-detail-page__filter-conditions">
        {config.conditions.map((condition, index) => {
          const fieldType = analyzeSchema.find((f) => f.name === condition.field)?.type ?? "";
          const isUnary = UNARY_OPERATORS.has(condition.operator);
          const isNumeric = NUMERIC_TYPES.has(fieldType);

          return (
            <div key={index} className="pipeline-detail-page__filter-condition-row">
              {/* Field dropdown */}
              <Select
                ariaLabel={`Field for condition ${index + 1}`}
                value={condition.field}
                placeholder="— select field —"
                options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                onChange={(next) => handleConditionChange(index, { ...condition, field: next })}
              />

              {/* Operator dropdown */}
              <Select
                ariaLabel={`Operator for condition ${index + 1}`}
                value={condition.operator}
                options={FILTER_OPERATORS.map((op) => ({ value: op.value, label: op.label }))}
                onChange={(newOp) => {
                  const updatedCondition: FilterCondition = { ...condition, operator: newOp };
                  if (UNARY_OPERATORS.has(newOp)) {
                    delete updatedCondition.value;
                  } else if (updatedCondition.value === undefined) {
                    updatedCondition.value = "";
                  }
                  handleConditionChange(index, updatedCondition);
                }}
              />

              {/* Value input — hidden for unary operators */}
              {!isUnary && (
                <TextField
                  type={isNumeric ? "number" : "text"}
                  aria-label={`Value for condition ${index + 1}`}
                  value={condition.value ?? ""}
                  onChange={(e) =>
                    handleConditionChange(index, { ...condition, value: e.target.value })
                  }
                />
              )}

              {/* Remove button */}
              <button
                type="button"
                className="pipeline-detail-page__filter-remove-btn"
                aria-label={`Remove condition ${index + 1}`}
                onClick={() => handleRemoveCondition(index)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Add condition button */}
      <button
        type="button"
        className="pipeline-detail-page__filter-add-btn"
        onClick={handleAddCondition}
      >
        + Add condition
      </button>
    </div>
  );
}
