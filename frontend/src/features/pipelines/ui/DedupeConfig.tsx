// DedupeConfig — key-fields checklist + keep first/last toggle for the
// "dedupe" pipeline op (HEL-382). Reuses SelectFieldsConfig's checklist
// markup (`pipeline-detail-page__select-fields-*`) for the key multi-select
// — dedupe's `keys` is the same "flat set of field names" shape as select's
// `fields`, so an add-row picker (PivotConfig/UnpivotConfig's pattern) would
// be the wrong fit — and the filter-combinator toggle recipe (see
// SplitTextConfig's mode toggle) for the first/last choice. Leaving the key
// checklist empty is a valid configuration (whole-row distinct).

export interface DedupeConfigValue {
  keys: string[];
  keep: "first" | "last";
}

interface DedupeConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: DedupeConfigValue;
  /** Column names from the analyze endpoint's inputSchema for the key checklist. */
  analyzeColumns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: DedupeConfigValue) => void;
}

export function DedupeConfig({ config, analyzeColumns, onChange }: DedupeConfigProps) {
  function handleKeyToggle(field: string, checked: boolean) {
    const keys = checked ? [...config.keys, field] : config.keys.filter((f) => f !== field);
    onChange({ ...config, keys });
  }

  function handleKeepChange(keep: "first" | "last") {
    onChange({ ...config, keep });
  }

  return (
    <div className="pipeline-detail-page__dedupe-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Key fields</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Rows are compared on these fields. Leave empty to compare whole rows (distinct).
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
                    checked={config.keys.includes(col)}
                    onChange={(e) => {
                      handleKeyToggle(col, e.target.checked);
                    }}
                  />
                  {col}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pipeline-detail-page__filter-combinator">
        <span className="pipeline-detail-page__filter-combinator-label">Keep</span>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.keep === "first" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleKeepChange("first")}
          aria-pressed={config.keep === "first"}
        >
          FIRST
        </button>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.keep === "last" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleKeepChange("last")}
          aria-pressed={config.keep === "last"}
        >
          LAST
        </button>
      </div>
    </div>
  );
}
