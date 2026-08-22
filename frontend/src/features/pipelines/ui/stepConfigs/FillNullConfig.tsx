// FillNullConfig — columns checklist + strategy dropdown + conditional
// constant-value input for the "fillnull" pipeline op (HEL-388). The columns
// checklist reuses DedupeConfig's checklist markup (`select-fields-*`) —
// fillnull's `columns` is the same "flat set of field names" shape as
// dedupe's `keys` / select's `fields`. The constant-value text input is only
// rendered when `strategy` is `"constant"` (design.md: the other four
// strategies never read `value`).

import type { ChangeEvent } from "react";

import { Select, TextField } from "../../../../shared/ui/index";

export const FILL_NULL_STRATEGIES = ["constant", "forwardFill", "mean", "median", "mode"] as const;

export type FillNullStrategyValue = (typeof FILL_NULL_STRATEGIES)[number];

const STRATEGY_OPTIONS = FILL_NULL_STRATEGIES.map((s) => ({ value: s, label: s }));

export interface FillNullConfigValue {
  columns: string[];
  strategy: FillNullStrategyValue;
  value: string | null;
}

interface FillNullConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: FillNullConfigValue;
  /** Column names from the analyze endpoint's inputSchema for the columns checklist. */
  analyzeColumns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: FillNullConfigValue) => void;
}

export function FillNullConfig({ config, analyzeColumns, onChange }: FillNullConfigProps) {
  function handleColumnToggle(field: string, checked: boolean) {
    const columns = checked
      ? [...config.columns, field]
      : config.columns.filter((f) => f !== field);
    onChange({ ...config, columns });
  }

  function handleStrategyChange(strategy: string) {
    const next = FILL_NULL_STRATEGIES.includes(strategy as FillNullStrategyValue)
      ? (strategy as FillNullStrategyValue)
      : "constant";
    onChange({ ...config, strategy: next });
  }

  function handleValueChange(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...config, value: e.target.value });
  }

  return (
    <div className="pipeline-detail-page__dedupe-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Columns</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Only null cells (missing or explicit null) in these columns are filled.
        </p>

        {analyzeColumns.length === 0 ? (
          <ul
            className="pipeline-detail-page__select-fields-list"
            role="list"
            aria-label="Available fields"
          />
        ) : (
          <ul className="pipeline-detail-page__select-fields-list" role="list">
            {analyzeColumns.map((col) => (
              <li key={col} className="pipeline-detail-page__select-fields-item">
                <label className="pipeline-detail-page__select-fields-label">
                  <input
                    type="checkbox"
                    className="pipeline-detail-page__select-fields-checkbox"
                    checked={config.columns.includes(col)}
                    onChange={(e) => {
                      handleColumnToggle(col, e.target.checked);
                    }}
                  />
                  {col}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Strategy</span>
        <Select
          ariaLabel="Fill strategy"
          value={config.strategy}
          options={STRATEGY_OPTIONS}
          onChange={handleStrategyChange}
        />
      </div>

      {config.strategy === "constant" && (
        <div className="pipeline-detail-page__compute-field">
          <label className="pipeline-detail-page__compute-label" htmlFor="fillnull-value-input">
            Constant value
          </label>
          <TextField
            id="fillnull-value-input"
            placeholder="e.g. unknown"
            value={config.value ?? ""}
            onChange={handleValueChange}
            aria-label="Constant value"
          />
        </div>
      )}
    </div>
  );
}
